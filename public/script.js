(function () {
  const state = {
    customers: [],
    currentCustomerSlug: null,
    currentAppSlug: null,
  };

  // ---------- Tab navigation ----------
  const tabNotes = document.getElementById("tab-notes");
  const tabSettings = document.getElementById("tab-settings");
  const viewNotes = document.getElementById("view-notes");
  const viewSettings = document.getElementById("view-settings");

  tabNotes.addEventListener("click", () => switchTab("notes"));
  tabSettings.addEventListener("click", () => {
    switchTab("settings");
    loadPricingConfig();
    loadCustomerDiscounts();
  });

  function switchTab(tab) {
    const isNotes = tab === "notes";
    tabNotes.classList.toggle("active", isNotes);
    tabSettings.classList.toggle("active", !isNotes);
    viewNotes.classList.toggle("active", isNotes);
    viewSettings.classList.toggle("active", !isNotes);
  }

  // ---------- Helpers ----------
  async function api(path, options) {
    const res = await fetch(path, options);
    const contentType = res.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await res.json()
      : null;
    if (!res.ok) {
      throw new Error((body && body.error) || `Request failed: ${res.status}`);
    }
    return body;
  }

  function setStatus(el, message, isError) {
    el.textContent = message || "";
    el.className = "status-msg" + (isError ? " error" : message ? " success" : "");
  }

  // ---------- Customer selector ----------
  const customerSelect = document.getElementById("customer-select");
  const newCustomerBtn = document.getElementById("new-customer-btn");
  const newCustomerForm = document.getElementById("new-customer-form");
  const newCustomerName = document.getElementById("new-customer-name");
  const saveCustomerBtn = document.getElementById("save-customer-btn");
  const cancelCustomerBtn = document.getElementById("cancel-customer-btn");

  const appSelect = document.getElementById("app-select");
  const newAppBtn = document.getElementById("new-app-btn");
  const newAppForm = document.getElementById("new-app-form");
  const newAppName = document.getElementById("new-app-name");
  const saveAppBtn = document.getElementById("save-app-btn");
  const cancelAppBtn = document.getElementById("cancel-app-btn");

  const appWorkspace = document.getElementById("app-workspace");

  async function loadCustomers(selectSlug) {
    const customers = await api("/api/customers");
    state.customers = customers;
    customerSelect.innerHTML = '<option value="">-- Select customer --</option>';
    for (const c of customers) {
      const opt = document.createElement("option");
      opt.value = c.dbSlug;
      opt.textContent = c.name;
      customerSelect.appendChild(opt);
    }
    if (selectSlug) {
      customerSelect.value = selectSlug;
      customerSelect.dispatchEvent(new Event("change"));
    }
  }

  customerSelect.addEventListener("change", async () => {
    const slug = customerSelect.value;
    state.currentCustomerSlug = slug || null;
    state.currentAppSlug = null;
    appSelect.innerHTML = '<option value="">-- Select app --</option>';
    appWorkspace.classList.add("hidden");
    newAppBtn.disabled = !slug;
    appSelect.disabled = !slug;
    if (slug) {
      await loadApps(slug);
    }
  });

  async function loadApps(customerSlug, selectSlug) {
    const apps = await api(`/api/customers/${customerSlug}/apps`);
    appSelect.innerHTML = '<option value="">-- Select app --</option>';
    for (const a of apps) {
      const opt = document.createElement("option");
      opt.value = a.appSlug;
      opt.textContent = a.name;
      appSelect.appendChild(opt);
    }
    if (selectSlug) {
      appSelect.value = selectSlug;
      appSelect.dispatchEvent(new Event("change"));
    }
  }

  appSelect.addEventListener("change", async () => {
    const slug = appSelect.value;
    state.currentAppSlug = slug || null;
    if (slug) {
      appWorkspace.classList.remove("hidden");
      await loadNotes();
      hideAnalysisOutput();
    } else {
      appWorkspace.classList.add("hidden");
    }
  });

  newCustomerBtn.addEventListener("click", () => {
    newCustomerForm.classList.toggle("hidden");
    newCustomerName.value = "";
    newCustomerName.focus();
  });
  cancelCustomerBtn.addEventListener("click", () => {
    newCustomerForm.classList.add("hidden");
  });
  saveCustomerBtn.addEventListener("click", async () => {
    const name = newCustomerName.value.trim();
    if (!name) return;
    try {
      const customer = await api("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      newCustomerForm.classList.add("hidden");
      await loadCustomers(customer.dbSlug);
    } catch (err) {
      alert(err.message);
    }
  });

  newAppBtn.addEventListener("click", () => {
    newAppForm.classList.toggle("hidden");
    newAppName.value = "";
    newAppName.focus();
  });
  cancelAppBtn.addEventListener("click", () => {
    newAppForm.classList.add("hidden");
  });
  saveAppBtn.addEventListener("click", async () => {
    const name = newAppName.value.trim();
    if (!name || !state.currentCustomerSlug) return;
    try {
      const app = await api(
        `/api/customers/${state.currentCustomerSlug}/apps`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      newAppForm.classList.add("hidden");
      await loadApps(state.currentCustomerSlug, app.appSlug);
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Note type tabs ----------
  const noteTypeText = document.getElementById("note-type-text");
  const noteTypeFile = document.getElementById("note-type-file");
  const textNoteForm = document.getElementById("text-note-form");
  const fileNoteForm = document.getElementById("file-note-form");
  const noteStatus = document.getElementById("note-status");

  noteTypeText.addEventListener("click", () => {
    noteTypeText.classList.add("active");
    noteTypeFile.classList.remove("active");
    textNoteForm.classList.remove("hidden");
    fileNoteForm.classList.add("hidden");
  });
  noteTypeFile.addEventListener("click", () => {
    noteTypeFile.classList.add("active");
    noteTypeText.classList.remove("active");
    fileNoteForm.classList.remove("hidden");
    textNoteForm.classList.add("hidden");
  });

  textNoteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("text-note-title").value.trim();
    const body = document.getElementById("text-note-body").value.trim();
    if (!title || !body) return;
    try {
      await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body }),
        }
      );
      textNoteForm.reset();
      setStatus(noteStatus, "Note saved.");
      await loadNotes();
    } catch (err) {
      setStatus(noteStatus, err.message, true);
    }
  });

  fileNoteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("file-note-title").value.trim();
    const fileInput = document.getElementById("file-note-input");
    const file = fileInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    if (title) formData.append("title", title);
    try {
      await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes/upload`,
        {
          method: "POST",
          body: formData,
        }
      );
      fileNoteForm.reset();
      setStatus(noteStatus, "File uploaded.");
      await loadNotes();
    } catch (err) {
      setStatus(noteStatus, err.message, true);
    }
  });

  // ---------- Notes list ----------
  const notesList = document.getElementById("notes-list");

  async function loadNotes() {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    const notes = await api(
      `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes`
    );
    notesList.innerHTML = "";
    if (notes.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No notes yet.";
      notesList.appendChild(li);
      return;
    }
    for (const note of notes) {
      const li = document.createElement("li");
      const date = new Date(note.createdAt).toLocaleString();
      if (note.type === "file") {
        const fileUrl = `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/files/${note.fileId}`;
        li.innerHTML = `
          <div class="note-title">${escapeHtml(note.title)}</div>
          <div class="note-meta">${date} - file - ${escapeHtml(note.filename)} (${formatBytes(note.size)})</div>
          <div class="note-body-preview"><a href="${fileUrl}" target="_blank">Download / View</a></div>
        `;
      } else {
        const preview =
          note.body.length > 300 ? note.body.slice(0, 300) + "..." : note.body;
        li.innerHTML = `
          <div class="note-title">${escapeHtml(note.title)}</div>
          <div class="note-meta">${date} - text</div>
          <div class="note-body-preview">${escapeHtml(preview)}</div>
        `;
      }
      notesList.appendChild(li);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(1)} ${units[i]}`;
  }

  // ---------- Analysis ----------
  const sizingBtn = document.getElementById("sizing-btn");
  const schemaBtn = document.getElementById("schema-btn");
  const analysisOutputWrap = document.getElementById("analysis-output-wrap");
  const analysisOutputTitle = document.getElementById("analysis-output-title");
  const analysisOutput = document.getElementById("analysis-output");
  const copyOutputBtn = document.getElementById("copy-output-btn");

  function hideAnalysisOutput() {
    analysisOutputWrap.classList.add("hidden");
    analysisOutput.textContent = "";
  }

  sizingBtn.addEventListener("click", async () => {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    sizingBtn.disabled = true;
    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/analysis/sizing`
      );
      analysisOutputTitle.textContent = "Sizing Recommendation";
      analysisOutput.textContent = result.text;
      analysisOutputWrap.classList.remove("hidden");
    } catch (err) {
      alert(err.message);
    } finally {
      sizingBtn.disabled = false;
    }
  });

  schemaBtn.addEventListener("click", async () => {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    schemaBtn.disabled = true;
    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/analysis/schema`
      );
      analysisOutputTitle.textContent = "Schema Design Findings";
      analysisOutput.textContent = result.text;
      analysisOutputWrap.classList.remove("hidden");
    } catch (err) {
      alert(err.message);
    } finally {
      schemaBtn.disabled = false;
    }
  });

  copyOutputBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(analysisOutput.textContent).then(() => {
      const original = copyOutputBtn.textContent;
      copyOutputBtn.textContent = "Copied!";
      setTimeout(() => (copyOutputBtn.textContent = original), 1500);
    });
  });

  // ---------- Settings: Tier Pricing ----------
  const tiersTbody = document.getElementById("tiers-tbody");
  const addTierRowBtn = document.getElementById("add-tier-row-btn");
  const globalDiscountInput = document.getElementById("global-discount-input");
  const savePricingBtn = document.getElementById("save-pricing-btn");
  const pricingStatus = document.getElementById("pricing-status");

  function addTierRow(tier) {
    tier = tier || { tier: "", ramGB: "", storageGB: "", vCPUs: "", monthlyPrice: "" };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="tier-name" value="${tier.tier ?? ""}" /></td>
      <td><input type="number" step="0.1" class="tier-ram" value="${tier.ramGB ?? ""}" /></td>
      <td><input type="number" step="0.1" class="tier-storage" value="${tier.storageGB ?? ""}" /></td>
      <td><input type="number" step="1" class="tier-vcpus" value="${tier.vCPUs ?? ""}" /></td>
      <td><input type="number" step="0.01" class="tier-price" value="${tier.monthlyPrice ?? ""}" /></td>
      <td><button type="button" class="btn-secondary remove-tier-row">Remove</button></td>
    `;
    tr.querySelector(".remove-tier-row").addEventListener("click", () => tr.remove());
    tiersTbody.appendChild(tr);
  }

  addTierRowBtn.addEventListener("click", () => addTierRow());

  async function loadPricingConfig() {
    const config = await api("/api/config/pricing");
    tiersTbody.innerHTML = "";
    for (const tier of config.tiers) {
      addTierRow(tier);
    }
    globalDiscountInput.value = config.discountPercent ?? 0;
  }

  savePricingBtn.addEventListener("click", async () => {
    const rows = [...tiersTbody.querySelectorAll("tr")];
    const tiers = rows.map((row) => ({
      tier: row.querySelector(".tier-name").value.trim(),
      ramGB: row.querySelector(".tier-ram").value
        ? Number(row.querySelector(".tier-ram").value)
        : null,
      storageGB: Number(row.querySelector(".tier-storage").value),
      vCPUs: row.querySelector(".tier-vcpus").value
        ? Number(row.querySelector(".tier-vcpus").value)
        : null,
      monthlyPrice: Number(row.querySelector(".tier-price").value),
    }));
    const discountPercent = Number(globalDiscountInput.value) || 0;
    try {
      await api("/api/config/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers, discountPercent }),
      });
      setStatus(pricingStatus, "Pricing config saved.");
    } catch (err) {
      setStatus(pricingStatus, err.message, true);
    }
  });

  // ---------- Settings: Customer Discount Overrides ----------
  const customerDiscountsTbody = document.getElementById(
    "customer-discounts-tbody"
  );
  const customerDiscountStatus = document.getElementById(
    "customer-discount-status"
  );

  async function loadCustomerDiscounts() {
    const customers = await api("/api/customers");
    customerDiscountsTbody.innerHTML = "";
    for (const c of customers) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(c.name)}</td>
        <td><input type="number" min="0" max="100" step="0.1" class="customer-discount-input" value="${
          c.discountPercent ?? ""
        }" placeholder="use global" /></td>
        <td><button type="button" class="btn-secondary save-customer-discount">Save</button></td>
      `;
      tr.querySelector(".save-customer-discount").addEventListener(
        "click",
        async () => {
          const val = tr.querySelector(".customer-discount-input").value;
          const discountPercent = val === "" ? null : Number(val);
          try {
            await api(`/api/customers/${c.dbSlug}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discountPercent }),
            });
            setStatus(customerDiscountStatus, `Updated discount for ${c.name}.`);
          } catch (err) {
            setStatus(customerDiscountStatus, err.message, true);
          }
        }
      );
      customerDiscountsTbody.appendChild(tr);
    }
  }

  // ---------- Init ----------
  loadCustomers();
})();
