import os
import json
from typing import Dict, Any, Tuple, List

from aiohttp import web
from server import PromptServer
import folder_paths

MAX_VARS = 5
STORE_FOLDER_NAME = "Nebula-Image-Manager"


# ----------------------------
# Storage helpers
# ----------------------------

def get_store_dir() -> str:
    base = folder_paths.base_path  # ComfyUI root
    path = os.path.join(base, STORE_FOLDER_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def safe_name(name: str) -> str:
    name = (name or "").strip()
    name = name.replace("\\", "_").replace("/", "_").replace("..", "_")
    if not name:
        return ""
    if not name.lower().endswith(".json"):
        name += ".json"
    return name


def parse_typed_value(dtype: str, raw: Any):
    raw = "" if raw is None else str(raw)
    dtype = (dtype or "string").lower().strip()

    if dtype == "int":
        try:
            return int(raw)
        except Exception:
            return 0

    if dtype == "float":
        try:
            return float(raw)
        except Exception:
            return 0.0

    return raw


def normalize_vars_from_kwargs(kwargs: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for i in range(1, MAX_VARS + 1):
        key = str(kwargs.get(f"var_{i}_name", "") or "").strip()
        dtype = str(kwargs.get(f"var_{i}_type", "string") or "string").strip().lower()
        if dtype not in ["string", "int", "float"]:
            dtype = "string"

        raw = kwargs.get(f"var_{i}_value", "")
        raw = "" if raw is None else str(raw)

        out.append({
            "key": key,
            "type": dtype,
            "value": raw,
            "typedValue": parse_typed_value(dtype, raw),
        })
    return out


def write_project_file(project_name: str, positive: str, negative: str, vars_rows: List[Dict[str, Any]]) -> str:
    name = safe_name(project_name)
    if not name:
        return ""

    data = {
        "project": name,
        "positive_prompt": positive or "",
        "negative_prompt": negative or "",
        "variables": [
            {
                "key": v.get("key", ""),
                "type": v.get("type", "string"),
                "value": v.get("value", ""),
                "typedValue": v.get("typedValue", ""),
            }
            for v in (vars_rows[:MAX_VARS] if isinstance(vars_rows, list) else [])
        ],
    }

    path = os.path.join(get_store_dir(), name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return path


# ----------------------------
# API ROUTES (used by JS UI)
# ----------------------------

@PromptServer.instance.routes.get("/nebula_image_manager/list")
async def nim_list(request: web.Request):
    store = get_store_dir()
    files = []
    for fn in os.listdir(store):
        if fn.lower().endswith(".json") and os.path.isfile(os.path.join(store, fn)):
            files.append(fn)
    files.sort(key=lambda x: x.lower())
    return web.json_response({"files": files})


@PromptServer.instance.routes.get("/nebula_image_manager/load")
async def nim_load(request: web.Request):
    name = safe_name(request.query.get("name", ""))
    if not name:
        return web.json_response({"error": "Missing name"}, status=400)

    path = os.path.join(get_store_dir(), name)
    if not os.path.exists(path):
        return web.json_response({"error": "Not found"}, status=404)

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return web.json_response({"error": f"Failed to read JSON: {e}"}, status=500)

    positive = data.get("positive_prompt", data.get("prompt", "")) or ""  # backward compat
    negative = data.get("negative_prompt", "") or ""

    vars_in = data.get("variables", [])
    if not isinstance(vars_in, list):
        vars_in = []

    norm = []
    for i in range(MAX_VARS):
        item = vars_in[i] if i < len(vars_in) and isinstance(vars_in[i], dict) else {}
        key = item.get("key", "") or ""
        dtype = (item.get("type", "string") or "string").lower()
        if dtype not in ["string", "int", "float"]:
            dtype = "string"
        value = item.get("value", "")
        norm.append({"key": key, "type": dtype, "value": "" if value is None else str(value)})

    return web.json_response({
        "name": name,
        "positive_prompt": positive,
        "negative_prompt": negative,
        "vars": norm
    })


@PromptServer.instance.routes.post("/nebula_image_manager/save")
async def nim_save(request: web.Request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    name = payload.get("name", "")
    positive = payload.get("positive_prompt", "")
    negative = payload.get("negative_prompt", "")

    vars_in = payload.get("vars", [])
    if not isinstance(vars_in, list):
        vars_in = []

    vars_rows = []
    for i in range(MAX_VARS):
        item = vars_in[i] if i < len(vars_in) and isinstance(vars_in[i], dict) else {}
        key = str(item.get("key", "") or "").strip()
        dtype = str(item.get("type", "string") or "string").strip().lower()
        if dtype not in ["string", "int", "float"]:
            dtype = "string"
        value = item.get("value", "")
        vars_rows.append({
            "key": key,
            "type": dtype,
            "value": "" if value is None else str(value),
            "typedValue": parse_typed_value(dtype, value),
        })

    try:
        path = write_project_file(name, positive or "", negative or "", vars_rows)
        if not path:
            return web.json_response({"error": "Project name is required"}, status=400)
    except Exception as e:
        return web.json_response({"error": f"Failed to write JSON: {e}"}, status=500)

    return web.json_response({"ok": True, "name": safe_name(name)})


# ----------------------------
# NODE
# ----------------------------

class NebulaPromptManager:
    """
    Separate outputs:
      Positive (STRING)
      Negative (STRING)
      Variable_1..Variable_5 (STRING each)
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        req = {
            "project_name": ("STRING", {"default": "", "multiline": False}),
            "positive_prompt": ("STRING", {"default": "", "multiline": True}),
            "negative_prompt": ("STRING", {"default": "", "multiline": True}),
        }
        for i in range(1, MAX_VARS + 1):
            req[f"var_{i}_name"] = ("STRING", {"default": "", "multiline": False})
            req[f"var_{i}_type"] = (["string", "int", "float"], {"default": "string"})
            req[f"var_{i}_value"] = ("STRING", {"default": "", "multiline": False})
        return {"required": req}

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("Positive", "Negative", "Variable_1", "Variable_2", "Variable_3", "Variable_4", "Variable_5")
    FUNCTION = "run"
    CATEGORY = "Nebula"

    def run(
        self,
        project_name: str,
        positive_prompt: str,
        negative_prompt: str,
        **kwargs
    ) -> Tuple[str, str, str, str, str, str, str]:

        positive_prompt = positive_prompt or ""
        negative_prompt = negative_prompt or ""

        vars_rows = normalize_vars_from_kwargs(kwargs)

        var_out = []
        for v in vars_rows:
            has_name = bool((v.get("key") or "").strip())
            has_value = bool((v.get("value") or "").strip())
            if not (has_name or has_value):
                var_out.append("")
            else:
                var_out.append(str(v.get("typedValue")))

        while len(var_out) < MAX_VARS:
            var_out.append("")
        var_out = var_out[:MAX_VARS]

        return (positive_prompt, negative_prompt, var_out[0], var_out[1], var_out[2], var_out[3], var_out[4])


NODE_CLASS_MAPPINGS = {"NebulaPromptManager": NebulaPromptManager}
NODE_DISPLAY_NAME_MAPPINGS = {"NebulaPromptManager": "Nebula Prompt Manager"}
