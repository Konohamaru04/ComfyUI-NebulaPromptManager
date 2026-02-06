import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "nebula.prompt_manager.ui_v4",

  async nodeCreated(node) {
    if (node.comfyClass !== "NebulaPromptManager") return;

    // Backend widgets (hidden)
    const wProject  = node.widgets.find(w => w.name === "project_name");
    const wPos      = node.widgets.find(w => w.name === "positive_prompt");
    const wNeg      = node.widgets.find(w => w.name === "negative_prompt");

    const rows = [];
    for (let i = 1; i <= 5; i++) {
      rows.push({
        key:   node.widgets.find(w => w.name === `var_${i}_name`),
        type:  node.widgets.find(w => w.name === `var_${i}_type`),
        value: node.widgets.find(w => w.name === `var_${i}_value`)
      });
    }

    if (!wProject || !wPos || !wNeg || rows.some(r => !r.key || !r.type || !r.value)) return;

    // Hide raw widgets
    const hideWidget = (w) => {
      w.type = "hidden";
      w.computeSize = () => [0, -4];
    };
    hideWidget(wProject);
    hideWidget(wPos);
    hideWidget(wNeg);
    rows.forEach(r => { hideWidget(r.key); hideWidget(r.type); hideWidget(r.value); });

    const markDirty = () => {
      node.setDirtyCanvas(true, true);
      app.graph.setDirtyCanvas(true, true);
    };

    async function apiGet(path) {
      const r = await fetch(path);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }

    async function apiPost(path, body) {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    }

    // --------- UI ---------
    const style = document.createElement("style");
    style.textContent = `
      .nim-wrap { display:flex; flex-direction:column; gap:10px; padding:6px 0; }
      .nim-card { border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px; background:rgba(0,0,0,0.14); }
      .nim-hdr { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
      .nim-title { font-weight:800; font-size:13px; letter-spacing:0.2px; opacity:0.95; }
      .nim-sub { font-size:12px; opacity:0.7; margin-top:2px; line-height:1.2; }
      .nim-row { display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap; }
      .nim-inp, .nim-select, .nim-ta {
        border-radius:10px; border:1px solid rgba(255,255,255,0.12);
        background:rgba(0,0,0,0.16); color:inherit; padding:8px 10px; box-sizing:border-box;
      }
      .nim-inp { width:100%; }
      .nim-ta { width:100%; min-height:90px; resize:vertical; }
      .nim-select { padding:8px 10px; }
      .nim-btn {
        padding:8px 12px; border-radius:10px;
        border:1px solid rgba(255,255,255,0.14);
        background:rgba(255,255,255,0.06);
        cursor:pointer; color:inherit;
        font-weight:650;
      }
      .nim-btn:hover { background:rgba(255,255,255,0.10); }
      .nim-btn.primary { background:rgba(80,160,255,0.22); border-color:rgba(80,160,255,0.35); }
      .nim-btn.primary:hover { background:rgba(80,160,255,0.28); }
      .nim-btn.good { background:rgba(120,220,120,0.16); border-color:rgba(120,220,120,0.28); }
      .nim-btn.good:hover { background:rgba(120,220,120,0.22); }
      .nim-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .nim-status {
        display:inline-flex; align-items:center; gap:8px;
        padding:6px 10px; border-radius:999px;
        border:1px solid rgba(255,255,255,0.12);
        background:rgba(0,0,0,0.12);
        font-size:12px; opacity:0.95;
      }
      .nim-dot { width:8px; height:8px; border-radius:999px; background:rgba(120,220,120,0.9); }
      .nim-dot.warn { background:rgba(255,200,80,0.95); }
      .nim-dot.err { background:rgba(255,100,100,0.95); }

      /* Layout */
      .nim-split { display:grid; grid-template-columns: 1.25fr 1fr; gap:10px; }
      .nim-grid-h { display:grid; grid-template-columns: 1.2fr 0.9fr 1.2fr; gap:8px; margin-top:10px; font-size:12px; opacity:0.7; }
      .nim-grid { display:grid; grid-template-columns: 1.2fr 0.9fr 1.2fr; gap:8px; margin-top:8px; }

      /* Dropdown expanded color (browser-limited but helps in many cases) */
      .nim-select { color-scheme: dark; }
      .nim-select option { background: #14161a; color: #e6e6e6; }
      .nim-select:focus { outline: none; box-shadow: 0 0 0 2px rgba(80,160,255,0.25); border-color: rgba(80,160,255,0.35); }
    `;

    const wrap = document.createElement("div");
    wrap.className = "nim-wrap";
    wrap.appendChild(style);

    // Card: Project controls
    const card1 = document.createElement("div");
    card1.className = "nim-card";

    const hdr = document.createElement("div");
    hdr.className = "nim-hdr";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "nim-title";
    title.textContent = "Nebula Prompt Manager";

    const sub = document.createElement("div");
    sub.className = "nim-sub";
    sub.textContent = "Save/Load positive+negative prompts + 5 typed variables (Nebula-Image-Manager folder).";

    left.appendChild(title);
    left.appendChild(sub);

    const status = document.createElement("div");
    status.className = "nim-status";
    status.innerHTML = `<span class="nim-dot"></span><span>Ready</span>`;

    hdr.appendChild(left);
    hdr.appendChild(status);
    card1.appendChild(hdr);

    const setStatus = (text, kind = "ok") => {
      const dot = status.querySelector(".nim-dot");
      const txt = status.querySelector("span:last-child");
      dot.classList.remove("warn", "err");
      if (kind === "warn") dot.classList.add("warn");
      if (kind === "err") dot.classList.add("err");
      txt.textContent = text;
    };

    // Dropdown + refresh
    const selRow = document.createElement("div");
    selRow.className = "nim-row";

    const select = document.createElement("select");
    select.className = "nim-select";
    select.style.flex = "1";

    const btnRefresh = document.createElement("button");
    btnRefresh.className = "nim-btn";
    btnRefresh.textContent = "Refresh list";

    selRow.appendChild(select);
    selRow.appendChild(btnRefresh);
    card1.appendChild(selRow);

    // Buttons
    const actRow = document.createElement("div");
    actRow.className = "nim-row";

    const btnNew = document.createElement("button");
    btnNew.className = "nim-btn primary";
    btnNew.textContent = "New project";

    const btnLoad = document.createElement("button");
    btnLoad.className = "nim-btn";
    btnLoad.textContent = "Load project";

    const btnSave = document.createElement("button");
    btnSave.className = "nim-btn good";
    btnSave.textContent = "Save / Update";

    actRow.appendChild(btnNew);
    actRow.appendChild(btnLoad);
    actRow.appendChild(btnSave);
    card1.appendChild(actRow);

    // Project name input
    const projectRow = document.createElement("div");
    projectRow.className = "nim-row";

    const projectNameInput = document.createElement("input");
    projectNameInput.className = "nim-inp";
    projectNameInput.type = "text";
    projectNameInput.placeholder = "Project name (e.g. my_scene_01)";
    projectNameInput.value = wProject.value || "";
    projectNameInput.disabled = true;

    projectNameInput.addEventListener("input", () => {
      wProject.value = projectNameInput.value;
      markDirty();
    });

    projectRow.appendChild(projectNameInput);
    card1.appendChild(projectRow);

    // Card: Prompts + Vars
    const card2 = document.createElement("div");
    card2.className = "nim-card";

    const split = document.createElement("div");
    split.className = "nim-split";

    // Prompts column
    const promptCol = document.createElement("div");

    const posLbl = document.createElement("div");
    posLbl.className = "nim-title";
    posLbl.textContent = "Positive Prompt";

    const posTA = document.createElement("textarea");
    posTA.className = "nim-ta";
    posTA.placeholder = "Write your positive prompt here…";
    posTA.value = wPos.value || "";
    posTA.addEventListener("input", () => {
      wPos.value = posTA.value;
      markDirty();
    });

    const negLbl = document.createElement("div");
    negLbl.className = "nim-title";
    negLbl.style.marginTop = "10px";
    negLbl.textContent = "Negative Prompt";

    const negTA = document.createElement("textarea");
    negTA.className = "nim-ta";
    negTA.placeholder = "Write your negative prompt here…";
    negTA.value = wNeg.value || "";
    negTA.addEventListener("input", () => {
      wNeg.value = negTA.value;
      markDirty();
    });

    promptCol.appendChild(posLbl);
    promptCol.appendChild(posTA);
    promptCol.appendChild(negLbl);
    promptCol.appendChild(negTA);

    // Vars column
    const varCol = document.createElement("div");
    const varLbl = document.createElement("div");
    varLbl.className = "nim-title";
    varLbl.textContent = "Variables (5)";

    const gridHdr = document.createElement("div");
    gridHdr.className = "nim-grid-h";
    gridHdr.innerHTML = `<div>Name</div><div>Type</div><div>Value</div>`;

    const grid = document.createElement("div");
    grid.className = "nim-grid";

    const domVarName = [];
    const domVarType = [];
    const domVarValue = [];

    function addVarRow(i) {
      const r = rows[i];

      const name = document.createElement("input");
      name.className = "nim-inp";
      name.type = "text";
      name.placeholder = "e.g. cfg";
      name.value = r.key.value || "";
      name.addEventListener("input", () => {
        r.key.value = name.value;
        markDirty();
      });

      const type = document.createElement("select");
      type.className = "nim-select";
      ["string", "int", "float"].forEach(t => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        type.appendChild(opt);
      });
      type.value = r.type.value || "string";
      type.addEventListener("change", () => {
        r.type.value = type.value;
        markDirty();
      });

      const value = document.createElement("input");
      value.className = "nim-inp";
      value.type = "text";
      value.placeholder = "value";
      value.value = r.value.value || "";
      value.addEventListener("input", () => {
        r.value.value = value.value;
        markDirty();
      });

      domVarName[i] = name;
      domVarType[i] = type;
      domVarValue[i] = value;

      grid.appendChild(name);
      grid.appendChild(type);
      grid.appendChild(value);
    }

    for (let i = 0; i < 5; i++) addVarRow(i);

    varCol.appendChild(varLbl);
    varCol.appendChild(gridHdr);
    varCol.appendChild(grid);

    split.appendChild(promptCol);
    split.appendChild(varCol);
    card2.appendChild(split);

    // mount
    wrap.appendChild(card1);
    wrap.appendChild(card2);
    node.addDOMWidget("nebula_prompt_manager_ui", "div", wrap, { serialize: false });

    // --------- Logic ---------
    function fillSelect(files, keepValue = true) {
      const current = select.value;
      select.innerHTML = "";

      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "-- Select project --";
      select.appendChild(opt0);

      (files || []).forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        select.appendChild(opt);
      });

      if (keepValue && current && (files || []).includes(current)) select.value = current;
      else select.value = "";
    }

    async function refreshList(keep = true) {
      setStatus("Refreshing…", "warn");
      try {
        const data = await apiGet("/nebula_image_manager/list");
        fillSelect(data.files || [], keep);
        setStatus(`Found ${(data.files || []).length} project(s)`, "ok");
      } catch (e) {
        setStatus(`Refresh failed: ${e.message}`, "err");
      }
    }

    function collectVars() {
      return rows.map(r => ({
        key: r.key.value || "",
        type: r.type.value || "string",
        value: r.value.value || ""
      }));
    }

    function applyLoadedToUI(data) {
      wProject.value = data.name || "";
      wPos.value = data.positive_prompt || "";
      wNeg.value = data.negative_prompt || "";

      const vars = data.vars || [];
      for (let i = 0; i < 5; i++) {
        const v = vars[i] || {};
        rows[i].key.value = v.key || "";
        rows[i].type.value = v.type || "string";
        rows[i].value.value = v.value || "";
      }

      projectNameInput.value = wProject.value || "";
      posTA.value = wPos.value || "";
      negTA.value = wNeg.value || "";

      for (let i = 0; i < 5; i++) {
        domVarName[i].value = rows[i].key.value || "";
        domVarType[i].value = rows[i].type.value || "string";
        domVarValue[i].value = rows[i].value.value || "";
      }

      markDirty();
    }

    let newMode = false;

    btnNew.addEventListener("click", () => {
      newMode = !newMode;
      projectNameInput.disabled = !newMode;

      if (newMode) {
        projectNameInput.value = "";
        wProject.value = "";
        markDirty();
        setStatus("New mode: type project name, then Save/Update", "warn");
        projectNameInput.focus();
      } else {
        setStatus("New mode off", "ok");
      }
    });

    btnLoad.addEventListener("click", async () => {
      const name = select.value;
      if (!name) {
        setStatus("Select a project first", "warn");
        return;
      }

      setStatus("Loading…", "warn");
      try {
        const data = await apiGet(`/nebula_image_manager/load?name=${encodeURIComponent(name)}`);
        newMode = false;
        projectNameInput.disabled = true;
        applyLoadedToUI(data);
        setStatus("Loaded", "ok");
      } catch (e) {
        setStatus(`Load failed: ${e.message}`, "err");
      }
    });

    btnSave.addEventListener("click", async () => {
      const name = (wProject.value || "").trim();
      if (!name) {
        setStatus("Project name required (use New project)", "warn");
        return;
      }

      setStatus("Saving…", "warn");
      try {
        const payload = {
          name,
          positive_prompt: wPos.value || "",
          negative_prompt: wNeg.value || "",
          vars: collectVars()
        };

        const res = await apiPost("/nebula_image_manager/save", payload);

        await refreshList(false);
        select.value = res.name || "";
        setStatus("Saved", "ok");
      } catch (e) {
        setStatus(`Save failed: ${e.message}`, "err");
      }
    });

    btnRefresh.addEventListener("click", async () => {
      await refreshList(true);
    });

    // initial
    await refreshList(true);
    setStatus("Ready", "ok");
  }
});
