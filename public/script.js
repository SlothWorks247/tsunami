(function () {
  const state = {
    customers: [],
    currentCustomerSlug: null,
    currentAppSlug: null,
    chatHistory: [],
  };

  let logSource = null;

  // ---------- Connection screen ----------
  const viewConnect = document.getElementById("view-connect");
  const connectionIndicator = document.getElementById("connection-indicator");
  const connectionIndicatorText = document.getElementById(
    "connection-indicator-text"
  );
  const disconnectBtn = document.getElementById("disconnect-btn");
  const connectForm = document.getElementById("connect-form");
  const connectSubmitBtn = document.getElementById("connect-submit-btn");
  const connectStatus = document.getElementById("connect-status");

  async function checkConnectionStatus() {
    const status = await fetch("/api/auth/session").then((r) => r.json());
    if (status.authenticated) {
      showConnectedUI(status.host);
    } else {
      showConnectScreen();
    }
  }

  function showConnectScreen() {
    viewConnect.classList.add("active");
    document.getElementById("view-notes").classList.remove("active");
    document.getElementById("view-settings").classList.remove("active");
    connectionIndicator.classList.add("hidden");
    if (logSource) {
      logSource.close();
      logSource = null;
    }
  }

  function showConnectedUI(host) {
    viewConnect.classList.remove("active");
    document.getElementById("view-notes").classList.add("active");
    connectionIndicator.classList.remove("hidden");
    connectionIndicatorText.textContent = `Connected to ${host}`;
    startLogStream();
    loadCustomers();
  }

  connectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const host = document.getElementById("connect-host").value.trim();
    const username = document.getElementById("connect-username").value.trim();
    const password = document.getElementById("connect-password").value;
    connectSubmitBtn.disabled = true;
    connectSubmitBtn.textContent = "Connecting...";
    connectStatus.className = "status-msg";
    connectStatus.textContent = "";
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to connect");
      showConnectedUI(body.host);
    } catch (err) {
      connectStatus.className = "status-msg error";
      connectStatus.textContent = err.message;
    } finally {
      connectSubmitBtn.disabled = false;
      connectSubmitBtn.textContent = "Connect";
    }
  });

  disconnectBtn.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    state.currentCustomerSlug = null;
    state.currentAppSlug = null;
    state.chatHistory = [];
    showConnectScreen();
  });

  // ---------- SSE Log Stream ----------
  function startLogStream() {
    if (logSource) logSource.close();
    logSource = new EventSource("/api/log/stream");
    logSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data);
        appendLogEntry(entry.message, entry.type);
      } catch {
      }
    };
    logSource.onerror = () => {
      logSource.close();
      setTimeout(startLogStream, 5000);
    };
  }

  const logCard = document.getElementById("log-card");
  const logOutput = document.getElementById("log-output");

  function appendLogEntry(message, type) {
    logCard.classList.remove("hidden");
    const div = document.createElement("div");
    div.className = `log-entry log-${type || "info"}`;
    const time = new Date().toLocaleTimeString();
    div.textContent = `[${time}] ${message}`;
    logOutput.appendChild(div);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  // ---------- Tab navigation ----------
  const tabSettings = document.getElementById("tab-settings");
  const viewNotes = document.getElementById("view-notes");
  const viewSettings = document.getElementById("view-settings");

  tabSettings.addEventListener("click", () => {
    switchTab("settings");
    loadPricingConfig();
    loadCustomerDiscounts();
    loadLLMConfig();
    loadEmbeddingsConfig();
    loadSkills();
  });

  function switchTab(tab) {
    const isNotes = tab === "notes";
    tabSettings.classList.toggle("active", !isNotes);
    viewNotes.classList.toggle("active", isNotes);
    viewSettings.classList.toggle("active", !isNotes);
  }

  // ---------- Helpers ----------
  async function api(path, options) {
    const res = await fetch(path, options);
    if (res.status === 401) {
      showConnectScreen();
      throw new Error("Session expired. Please log in again.");
    }
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
    state.chatHistory = [];
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
    state.chatHistory = [];
    clearChat();
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
  const imageModal = document.getElementById("image-modal");
  const imageModalImg = document.getElementById("image-modal-img");

  imageModal.addEventListener("click", () => closeImageModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeImageModal();
  });

  function openImageModal(url) {
    imageModalImg.src = url;
    imageModal.classList.remove("hidden");
  }

  function closeImageModal() {
    imageModal.classList.add("hidden");
    imageModalImg.src = "";
  }

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
      notesList.appendChild(renderNoteViewMode(note));
    }
  }

  function noteMetaLine(note) {
    const date = new Date(note.createdAt).toLocaleString();
    const edited =
      note.updatedAt && note.updatedAt !== note.createdAt ? " (edited)" : "";
    if (note.type === "file") {
      return `${date} - file - ${escapeHtml(note.filename)} (${formatBytes(
        note.size
      )})${edited}`;
    }
    return `${date} - text${edited}`;
  }

  function renderNoteViewMode(note) {
    const li = document.createElement("li");
    li.dataset.noteId = note._id;

    const titleDiv = document.createElement("div");
    titleDiv.className = "note-title";
    titleDiv.textContent = note.title;
    li.appendChild(titleDiv);

    const metaDiv = document.createElement("div");
    metaDiv.className = "note-meta";
    metaDiv.innerHTML = noteMetaLine(note);
    li.appendChild(metaDiv);

    if (note.type === "file") {
      const fileUrl = `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/files/${note.fileId}`;
      if (note.contentType && note.contentType.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "note-thumbnail";
        img.src = fileUrl;
        img.alt = note.filename;
        img.addEventListener("click", () => openImageModal(fileUrl));
        li.appendChild(img);
      } else {
        const bodyDiv = document.createElement("div");
        bodyDiv.className = "note-body-preview";
        bodyDiv.innerHTML = `<a href="${fileUrl}" target="_blank">Download / View</a>`;
        li.appendChild(bodyDiv);
      }
    } else {
      const bodyDiv = document.createElement("div");
      const lineCount = (note.body.match(/\n/g) || []).length + 1;
      const needsClamp = lineCount > 10 || note.body.length > 700;
      bodyDiv.className = needsClamp
        ? "note-body-preview clamped"
        : "note-body-preview";
      bodyDiv.textContent = note.body;
      li.appendChild(bodyDiv);

      if (needsClamp) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "show-more-link";
        toggle.textContent = "Show more";
        toggle.addEventListener("click", () => {
          const isClamped = bodyDiv.classList.toggle("clamped");
          toggle.textContent = isClamped ? "Show more" : "Show less";
        });
        li.appendChild(toggle);
      }
    }

    const actions = document.createElement("div");
    actions.className = "note-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "note-action-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      li.replaceWith(renderNoteEditMode(note));
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "note-action-btn delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteNote(note._id));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);

    return li;
  }

  function renderNoteEditMode(note) {
    const li = document.createElement("li");
    li.dataset.noteId = note._id;

    const form = document.createElement("div");
    form.className = "note-edit-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = note.title;
    titleInput.placeholder = "Title";
    form.appendChild(titleInput);

    let bodyTextarea = null;
    let fileInput = null;

    if (note.type === "text") {
      bodyTextarea = document.createElement("textarea");
      bodyTextarea.rows = 6;
      bodyTextarea.value = note.body;
      form.appendChild(bodyTextarea);
    } else {
      const fileLabel = document.createElement("label");
      fileLabel.textContent = "Replace file (optional)";
      form.appendChild(fileLabel);
      fileInput = document.createElement("input");
      fileInput.type = "file";
      form.appendChild(fileInput);
    }

    const actions = document.createElement("div");
    actions.className = "note-edit-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const title = titleInput.value.trim();
      if (!title) {
        alert("Title is required");
        return;
      }
      saveBtn.disabled = true;
      try {
        if (note.type === "text") {
          const body = bodyTextarea.value.trim();
          if (!body) throw new Error("Note body is required");
          await api(
            `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes/${note._id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, body }),
            }
          );
        } else if (fileInput.files[0]) {
          const formData = new FormData();
          formData.append("file", fileInput.files[0]);
          formData.append("title", title);
          await api(
            `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes/${note._id}/upload`,
            { method: "PUT", body: formData }
          );
        } else {
          await api(
            `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes/${note._id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            }
          );
        }
        await loadNotes();
      } catch (err) {
        alert(err.message);
        saveBtn.disabled = false;
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      li.replaceWith(renderNoteViewMode(note));
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);
    li.appendChild(form);

    return li;
  }

  async function deleteNote(noteId) {
    if (!confirm("Are you sure you want to delete this note?")) return;
    try {
      await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes/${noteId}`,
        { method: "DELETE" }
      );
      await loadNotes();
    } catch (err) {
      alert(err.message);
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

  // ---------- Chat (RAG) ----------
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  const chatRetrievalMode = document.getElementById("chat-retrieval-mode");
  const chatMeta = document.getElementById("chat-meta");

  function clearChat() {
    chatMessages.innerHTML = "";
    chatMeta.textContent = "";
    state.chatHistory = [];
  }

  function appendChatMessage(role, content) {
    const div = document.createElement("div");
    div.className = `chat-message chat-${role}`;
    div.textContent = content;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendChat() {
    const message = chatInput.value.trim();
    if (!message) return;
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;

    appendChatMessage("user", message);
    state.chatHistory.push({ role: "user", content: message });
    chatInput.value = "";
    chatSendBtn.disabled = true;
    chatSendBtn.textContent = "Thinking...";
    chatMeta.textContent = "";

    const typingDiv = document.createElement("div");
    typingDiv.className = "chat-message chat-assistant chat-typing";
    typingDiv.textContent = "...";
    chatMessages.appendChild(typingDiv);

    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            history: state.chatHistory.slice(-10, -1),
            retrievalMode: chatRetrievalMode.value,
          }),
        }
      );

      typingDiv.remove();
      appendChatMessage("assistant", result.reply);
      state.chatHistory.push({ role: "assistant", content: result.reply });

      const methodLabel =
        result.retrievalMethod === "vector" ? "Vector Search" : "All Notes";
      chatMeta.textContent = `Retrieval: ${methodLabel} | Notes used: ${result.notesUsed}/${result.notesTotal}`;
    } catch (err) {
      typingDiv.remove();
      appendChatMessage("assistant", `Error: ${err.message}`);
    } finally {
      chatSendBtn.disabled = false;
      chatSendBtn.textContent = "Send";
    }
  }

  chatSendBtn.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // ---------- Embeddings button ----------
  const embeddingsBtn = document.getElementById("embeddings-btn");

  embeddingsBtn.addEventListener("click", async () => {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    if (
      !confirm(
        "Generate embeddings for all notes in this app? This will chunk and embed any notes that don't already have embeddings."
      )
    )
      return;
    embeddingsBtn.disabled = true;
    embeddingsBtn.textContent = "Generating...";
    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/notes/backfill-embeddings`,
        { method: "POST" }
      );
      const msg = `Embeddings complete: ${result.embedded} embedded, ${result.skipped} skipped, ${result.failed} failed (of ${result.total} notes)`;
      appendLogEntry(msg, result.failed > 0 ? "error" : "success");
      if (result.firstError) {
        alert(`Completed with errors. First error: ${result.firstError}`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      embeddingsBtn.disabled = false;
      embeddingsBtn.textContent = "Generate Embeddings";
    }
  });

  // ---------- Executive Summary ----------
  const updateSummaryBtn = document.getElementById("update-summary-btn");
  const executiveSummaryOutput = document.getElementById(
    "executive-summary-output"
  );
  const summaryMeta = document.getElementById("summary-meta");

  updateSummaryBtn.addEventListener("click", async () => {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    updateSummaryBtn.disabled = true;
    updateSummaryBtn.textContent = "Generating...";
    executiveSummaryOutput.textContent = "";
    summaryMeta.textContent = "";
    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/summary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      executiveSummaryOutput.textContent = result.summary;
      const methodLabel =
        result.retrievalMethod === "vector"
          ? "Vector Search"
          : result.retrievalMethod === "none"
            ? "No notes"
            : "All Notes";
      summaryMeta.textContent = `Retrieval: ${methodLabel} | Notes used: ${result.notesUsed}/${result.notesTotal}`;
    } catch (err) {
      alert(err.message);
    } finally {
      updateSummaryBtn.disabled = false;
      updateSummaryBtn.textContent = "Update Summary";
    }
  });

  // ---------- Analysis ----------
  const sizingBtn = document.getElementById("sizing-btn");
  const schemaBtn = document.getElementById("schema-btn");
  const analysisOutputWrap = document.getElementById("analysis-output-wrap");
  const analysisOutputTitle = document.getElementById("analysis-output-title");
  const analysisOutput = document.getElementById("analysis-output");
  const copyOutputBtn = document.getElementById("copy-output-btn");
  const sizingForm = document.getElementById("sizing-form");
  const sizingDataSizeInput = document.getElementById("sizing-data-size");
  const sizingGrowthInput = document.getElementById("sizing-growth-multiplier");
  const sizingIndexOverheadInput = document.getElementById(
    "sizing-index-overhead"
  );
  const sizingCalculateBtn = document.getElementById("sizing-calculate-btn");

  function hideAnalysisOutput() {
    analysisOutputWrap.classList.add("hidden");
    analysisOutput.textContent = "";
    sizingForm.classList.add("hidden");
  }

  sizingBtn.addEventListener("click", () => {
    sizingForm.classList.toggle("hidden");
  });

  sizingCalculateBtn.addEventListener("click", async () => {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    sizingCalculateBtn.disabled = true;
    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/analysis/sizing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataSizeGB: sizingDataSizeInput.value,
            growthMultiplier: sizingGrowthInput.value,
            indexOverheadPercent: sizingIndexOverheadInput.value,
          }),
        }
      );
      analysisOutputTitle.textContent =
        result.data && result.data.needsMoreInfo
          ? "More Information Needed"
          : "Sizing Recommendation";
      analysisOutput.textContent = result.text;
      analysisOutputWrap.classList.remove("hidden");
    } catch (err) {
      alert(err.message);
    } finally {
      sizingCalculateBtn.disabled = false;
    }
  });

  schemaBtn.addEventListener("click", async () => {
    if (!state.currentCustomerSlug || !state.currentAppSlug) return;
    schemaBtn.disabled = true;
    try {
      const result = await api(
        `/api/customers/${state.currentCustomerSlug}/apps/${state.currentAppSlug}/analysis/schema`
      );
      analysisOutputTitle.textContent =
        result.data && result.data.needsMoreInfo
          ? "More Information Needed"
          : "Schema Design Findings";
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

  // ---------- Settings: AI Config ----------
  const DEFAULT_MODEL = "llama3.2:1b";

  const llmProvider = document.getElementById("llm-provider");
  const llmEndpoint = document.getElementById("llm-endpoint");
  const llmModelSelect = document.getElementById("llm-model-select");
  const llmModelInput = document.getElementById("llm-model-input");
  const llmApiKey = document.getElementById("llm-api-key");
  const llmSystemPrompt = document.getElementById("llm-system-prompt");
  const llmRules = document.getElementById("llm-rules");
  const saveLlmConfigBtn = document.getElementById("save-llm-config-btn");
  const llmConfigStatus = document.getElementById("llm-config-status");
  const llmFetchModelsBtn = document.getElementById("llm-fetch-models-btn");

  function getModelValue() {
    if (!llmModelSelect.classList.contains("hidden")) {
      return llmModelSelect.value;
    }
    return llmModelInput.value;
  }

  function setModelValue(value) {
    if (!llmModelSelect.classList.contains("hidden")) {
      for (const opt of llmModelSelect.options) {
        if (opt.value === value) {
          llmModelSelect.value = value;
          return;
        }
      }
    }
    llmModelInput.value = value;
  }

  async function loadOllamaModels() {
    const endpoint = llmEndpoint.value.trim() || "http://localhost:11434";
    llmModelSelect.innerHTML = '<option value="">Loading models...</option>';
    try {
      const result = await api(
        `/api/llm/models?endpoint=${encodeURIComponent(endpoint)}`
      );
      const models = result.models || [];
      if (models.length === 0) {
        llmModelSelect.classList.add("hidden");
        llmModelInput.classList.remove("hidden");
        if (!llmModelInput.value) llmModelInput.value = DEFAULT_MODEL;
        return;
      }
      llmModelSelect.classList.remove("hidden");
      llmModelInput.classList.add("hidden");
      llmModelSelect.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        llmModelSelect.appendChild(opt);
      }
      const current = llmModelInput.value || llmModelSelect.value;
      let selected = models.includes(DEFAULT_MODEL)
        ? DEFAULT_MODEL
        : models[0];
      if (current && models.includes(current)) selected = current;
      llmModelSelect.value = selected;
    } catch (err) {
      llmModelSelect.classList.add("hidden");
      llmModelInput.classList.remove("hidden");
      if (!llmModelInput.value) llmModelInput.value = DEFAULT_MODEL;
    }
  }

  function selectProvider(provider) {
    if (provider === "ollama") {
      if (!llmEndpoint.value || llmEndpoint.value === "https://api.openai.com")
        llmEndpoint.value = "http://localhost:11434";
      llmModelSelect.classList.remove("hidden");
      llmModelInput.classList.add("hidden");
      loadOllamaModels();
    } else if (provider === "openai") {
      llmModelSelect.classList.add("hidden");
      llmModelInput.classList.remove("hidden");
      if (llmEndpoint.value === "http://localhost:11434")
        llmEndpoint.value = "";
      if (!llmEndpoint.value) llmEndpoint.value = "https://api.openai.com";
      if (!llmModelInput.value) llmModelInput.value = "gpt-4o-mini";
    } else {
      llmModelSelect.classList.add("hidden");
      llmModelInput.classList.remove("hidden");
      if (llmEndpoint.value === "http://localhost:11434")
        llmEndpoint.value = "";
      if (!llmModelInput.value) llmModelInput.value = "";
    }
  }

  llmProvider.addEventListener("change", () => {
    selectProvider(llmProvider.value);
  });

  async function loadLLMConfig() {
    try {
      const config = await api("/api/llm/config");
      if (config.configured) {
        llmProvider.value = config.provider || "custom";
        llmEndpoint.value = config.endpoint || "";
        llmModelInput.value = config.model || "";
        selectProvider(config.provider || "custom");
      } else {
        selectProvider("ollama");
      }
      llmSystemPrompt.value = config.systemPrompt || "";
      llmRules.value = config.rules || "";
    } catch {
    }
  }

  llmFetchModelsBtn.addEventListener("click", () => {
    loadOllamaModels();
  });

  saveLlmConfigBtn.addEventListener("click", async () => {
    const endpoint = llmEndpoint.value.trim();
    const model = getModelValue().trim();
    if (!endpoint || !model) {
      setStatus(llmConfigStatus, "Endpoint and model are required.", true);
      return;
    }
    try {
      await api("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmProvider.value,
          endpoint,
          model,
          apiKey: llmApiKey.value || undefined,
          systemPrompt: llmSystemPrompt.value,
          rules: llmRules.value,
        }),
      });
      setStatus(llmConfigStatus, "LLM config saved.");
    } catch (err) {
      setStatus(llmConfigStatus, err.message, true);
    }
  });

  // ---------- Settings: Embeddings Config ----------
  const embeddingsApiKey = document.getElementById("embeddings-api-key");
  const embeddingsModel = document.getElementById("embeddings-model");
  const saveEmbeddingsConfigBtn = document.getElementById(
    "save-embeddings-config-btn"
  );
  const testEmbeddingsBtn = document.getElementById("test-embeddings-btn");
  const embeddingsConfigStatus = document.getElementById(
    "embeddings-config-status"
  );

  async function loadEmbeddingsConfig() {
    try {
      const config = await api("/api/llm/embeddings/config");
      if (config.model) {
        embeddingsModel.value = config.model;
      }
    } catch {
    }
  }

  saveEmbeddingsConfigBtn.addEventListener("click", async () => {
    try {
      await api("/api/llm/embeddings/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: embeddingsApiKey.value || undefined,
          model: embeddingsModel.value,
        }),
      });
      setStatus(embeddingsConfigStatus, "Embeddings config saved.");
      embeddingsApiKey.value = "";
    } catch (err) {
      setStatus(embeddingsConfigStatus, err.message, true);
    }
  });

  testEmbeddingsBtn.addEventListener("click", async () => {
    testEmbeddingsBtn.disabled = true;
    testEmbeddingsBtn.textContent = "Testing...";
    setStatus(embeddingsConfigStatus, "");
    try {
      const result = await api("/api/llm/embeddings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: embeddingsApiKey.value || undefined,
          model: embeddingsModel.value,
        }),
      });
      if (result.ok) {
        setStatus(
          embeddingsConfigStatus,
          `Connection successful! ${result.dimensions} dimensions, model: ${result.model}`
        );
      } else {
        setStatus(embeddingsConfigStatus, result.error || "Test failed.", true);
      }
    } catch (err) {
      setStatus(embeddingsConfigStatus, err.message, true);
    } finally {
      testEmbeddingsBtn.disabled = false;
      testEmbeddingsBtn.textContent = "Test Connection";
    }
  });

  // ---------- Settings: Skills ----------
  const defaultSkillName = document.getElementById("default-skill-name");
  const defaultSkillDesc = document.getElementById("default-skill-desc");
  const defaultSkillEnabled = document.getElementById(
    "default-skill-enabled"
  );
  const skillNameInput = document.getElementById("skill-name-input");
  const skillContentInput = document.getElementById("skill-content-input");
  const skillFileInput = document.getElementById("skill-file-input");
  const addSkillBtn = document.getElementById("add-skill-btn");
  const skillAddStatus = document.getElementById("skill-add-status");
  const customSkillsList = document.getElementById("custom-skills-list");

  async function loadSkills() {
    try {
      const data = await api("/api/skills");

      if (data.default.available) {
        defaultSkillName.textContent = data.default.name;
        defaultSkillDesc.textContent = data.default.description
          ? `${data.default.description} (~${data.default.sizeKB} KB)`
          : `~${data.default.sizeKB} KB`;
        defaultSkillEnabled.checked = data.default.enabled;
        defaultSkillEnabled.disabled = false;
      } else {
        defaultSkillName.textContent = "Not available";
        defaultSkillDesc.textContent =
          "Default skill files were not found on the server.";
        defaultSkillEnabled.disabled = true;
      }

      customSkillsList.innerHTML = "";
      if (data.custom.length === 0) {
        customSkillsList.innerHTML =
          '<p class="settings-hint">No custom skills added yet.</p>';
      } else {
        for (const skill of data.custom) {
          customSkillsList.appendChild(renderSkillRow(skill));
        }
      }
    } catch {
    }
  }

  function renderSkillRow(skill) {
    const row = document.createElement("div");
    row.className = "skill-row";
    row.innerHTML = `
      <div class="skill-row-info">
        <span class="skill-row-name">${escapeHtml(skill.name)}</span>
        <span class="skill-row-desc">${escapeHtml(
          skill.contentPreview
        )} (~${skill.sizeKB} KB)</span>
      </div>
      <label class="skill-toggle">
        <input type="checkbox" class="skill-enabled-toggle" ${
          skill.enabled ? "checked" : ""
        } />
        <span>Enabled</span>
      </label>
      <button type="button" class="btn-secondary skill-delete-btn">Delete</button>
    `;

    row.querySelector(".skill-enabled-toggle").addEventListener(
      "change",
      async (e) => {
        try {
          await api(`/api/skills/${skill.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: e.target.checked }),
          });
        } catch (err) {
          setStatus(skillAddStatus, err.message, true);
        }
      }
    );

    row.querySelector(".skill-delete-btn").addEventListener(
      "click",
      async () => {
        try {
          await api(`/api/skills/${skill.id}`, { method: "DELETE" });
          loadSkills();
        } catch (err) {
          setStatus(skillAddStatus, err.message, true);
        }
      }
    );

    return row;
  }

  defaultSkillEnabled.addEventListener("change", async (e) => {
    try {
      await api("/api/skills/default", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: e.target.checked }),
      });
    } catch (err) {
      setStatus(skillAddStatus, err.message, true);
      e.target.checked = !e.target.checked;
    }
  });

  skillFileInput.addEventListener("change", () => {
    const file = skillFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      skillContentInput.value = reader.result;
      if (!skillNameInput.value.trim()) {
        skillNameInput.value = file.name.replace(/\.(md|markdown|txt)$/i, "");
      }
    };
    reader.readAsText(file);
  });

  addSkillBtn.addEventListener("click", async () => {
    const name = skillNameInput.value.trim();
    const content = skillContentInput.value.trim();
    if (!name || !content) {
      setStatus(
        skillAddStatus,
        "Skill name and content are both required.",
        true
      );
      return;
    }
    try {
      await api("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      setStatus(skillAddStatus, `Skill "${name}" added.`);
      skillNameInput.value = "";
      skillContentInput.value = "";
      skillFileInput.value = "";
      loadSkills();
    } catch (err) {
      setStatus(skillAddStatus, err.message, true);
    }
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
      switchTab("notes");
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
  checkConnectionStatus();
})();
