(() => {
  const STORAGE_KEY = "monthly-schedule-dnd-v1";
  const CRITICAL_ROLES = ["N", "D", "E", "H", "M1", "M2", "M3", "P"];
  const REST_ROLES = ["X", "R", "A"];
  const BASE_PROTECTED_ROLES = ["X", "P", "D", "A"];
  const GROUPS = ["일반직", "전문직", "파견직"];
  const MAX_HISTORY = 50;
  const ROLE_MODULES = ["NW", "D", "E", "H", "M1", "M2", "M3", "P", "S", "R", "X", "A", ""];
  const ROLE_DEFS = {
    N: { name: "N", desc: "숙직", bg: "#d5a6bd", fg: "#4c1130" },
    D: { name: "D", desc: "데스크", bg: "#d0e0e3", fg: "#134f5c" },
    E: { name: "E", desc: "E", bg: "#fce5cd", fg: "#9a4d08" },
    H: { name: "H", desc: "조근", bg: "#d9ead3", fg: "#2f6d2a" },
    M1: { name: "M1", desc: "미들1", bg: "#d9d2e9", fg: "#351c75" },
    M2: { name: "M2", desc: "미들2", bg: "#d9d2e9", fg: "#351c75" },
    M3: { name: "M3", desc: "미들3", bg: "#d9d2e9", fg: "#351c75" },
    P: { name: "P", desc: "P", bg: "#fff2cc", fg: "#8a5a00" },
    S: { name: "S", desc: "일반", bg: "#eef6ff", fg: "#17456b" },
    R: { name: "R", desc: "대체휴무", bg: "#f4cccc", fg: "#8f2314" },
    W: { name: "W", desc: "야간후", bg: "#d5a6bd", fg: "#4c1130" },
    X: { name: "X", desc: "희망휴무", bg: "#f7c7c0", fg: "#8f2314" },
    A: { name: "A", desc: "보호휴무", bg: "#f4cccc", fg: "#8f2314" }
  };

  let state;
  let selectedRole = null;
  let latestIssues = [];
  let employeeSeed = 100;
  let historyStack = [];
  let dragPayload = null;
  let dropCheckCache = new Map();
  let employeeRowDragIndex = null;
  let scheduleCellMap = new Map();
  let employeeHeadMap = new Map();
  let activeDropPreviewCells = [];
  let activeDropPreviewHeads = [];
  let dragTooltip = null;
  let issueTooltip = null;
  let contextMenu = null;
  let isPainting = false;
  let paintHistoryCaptured = false;

  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    state = loadState() || createDefaultState();
    refreshEmployeeSeed();
    bindEvents();
    syncInputs();
    renderAll();
  }

  function cacheElements() {
    [
      "scheduleSummary", "togglePanelButton", "saveButton", "printButton", "generateButton", "startDateInput", "endDateInput",
      "targetOffInput", "maxConsecutiveInput", "shuffleSeedInput", "hProtectionToggle", "rolePalette", "holidayInput", "addHolidayButton",
      "holidayList", "nGapInput", "minActiveInput", "minEsInput", "fridayDsInput", "scheduleTab",
      "staffTab", "statsTab", "issuesTab", "forceModeButton", "validateModeButton", "validateButton", "clearButton", "csvImportButton", "csvButton", "csvFileInput", "notice",
      "scheduleView", "staffView", "statsView", "issuesView", "scheduleTable", "employeeTableBody",
      "statsGrid", "issueList", "addEmployeeButton", "staffHorizontalScroll", "staffHorizontalScrollInner"
    ].forEach(id => { el[id] = document.getElementById(id); });
  }

  function bindEvents() {
    el.saveButton.addEventListener("click", () => {
      saveState();
      showNotice("현재 근무표를 브라우저에 저장했습니다.");
    });
    el.printButton.addEventListener("click", () => window.print());
    el.togglePanelButton.addEventListener("click", () => {
      state.ui ||= {};
      state.ui.panelCollapsed = !state.ui.panelCollapsed;
      applyPanelState();
      saveState();
    });
    el.generateButton.addEventListener("click", () => {
      pushHistory("자동 생성");
      pullConfigFromInputs();
      generateSchedule();
      markLastChangedCells([]);
      state.ui ||= {};
      state.ui.editMode = "validate";
      applyModeState();
      validateAndRender({ switchTab: false });
      saveState();
    });
    el.forceModeButton.addEventListener("click", () => setEditMode("setup"));
    el.validateModeButton.addEventListener("click", () => setEditMode("validate"));
    el.validateButton.addEventListener("click", () => validateAndRender({ switchTab: false }));
    el.clearButton.addEventListener("click", () => {
      const keptRolesText = getProtectedRoles().join("/");
      if (!confirm(`자동 생성된 로테이션만 비울까요?\n수기로 배치한 ${keptRolesText}는 유지됩니다.`)) return;
      pushHistory("근무표 초기화");
      clearGeneratedScheduleKeepManualProtected();
      markLastChangedCells([]);
      latestIssues = [];
      renderAll();
      saveState();
    });
    el.csvButton.addEventListener("click", exportCsv);
    el.csvImportButton.addEventListener("click", () => el.csvFileInput.click());
    el.csvFileInput.addEventListener("change", importCsvFile);
    el.addHolidayButton.addEventListener("click", addHoliday);
    el.addEmployeeButton.addEventListener("click", () => {
      pushHistory("직원 추가");
      state.employees.push(createEmployee(`직원 ${state.employees.length + 1}`, "일반직"));
      renderAll();
      saveState();
    });
    document.querySelectorAll(".past-clear-button").forEach(button => {
      button.addEventListener("click", event => {
        const index = Number(event.currentTarget.dataset.pastIndex);
        clearPastColumn(index);
      });
    });
    bindStaffHorizontalScroll();
    el.hProtectionToggle.addEventListener("click", () => {
      pushHistory("H 보호 설정 변경");
      state.config.hProtection = !isHProtectionEnabled();
      syncHProtectionToggle();
      latestIssues = validateSchedule();
      renderSchedule();
      renderIssues(latestIssues);
      saveState();
    });

    ["startDateInput", "endDateInput", "targetOffInput", "maxConsecutiveInput", "shuffleSeedInput", "nGapInput", "minActiveInput", "minEsInput", "fridayDsInput"].forEach(id => {
      el[id].addEventListener("change", () => {
        pushHistory("설정 변경");
        pullConfigFromInputs();
        renderAll();
        saveState();
      });
    });

    [
      ["scheduleTab", "scheduleView"],
      ["staffTab", "staffView"],
      ["statsTab", "statsView"],
      ["issuesTab", "issuesView"]
    ].forEach(([tabId, viewId]) => {
      el[tabId].addEventListener("click", () => setActiveTab(tabId, viewId));
    });

    document.addEventListener("keydown", event => {
      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
      if (!isUndo || isFormControl(event.target)) return;
      event.preventDefault();
      undoLastChange();
    });
    document.addEventListener("mouseup", stopPainting);
    document.addEventListener("click", event => {
      if (contextMenu && !contextMenu.contains(event.target)) hideContextMenu();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") hideContextMenu();
    });
  }

  function createDefaultState() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const employees = [
      createEmployee("직원 1", "일반직", true, true, true, true),
      createEmployee("직원 2", "일반직", false, true, true, false),
      createEmployee("직원 3", "일반직", false, true, true, true),
      createEmployee("직원 4", "전문직", false, true, true, false),
      createEmployee("직원 5", "전문직", true, true, false, true),
      createEmployee("직원 6", "일반직", false, false, true, false),
      createEmployee("직원 7", "일반직", false, true, false, true),
      createEmployee("직원 8", "전문직", false, true, true, false),
      createEmployee("직원 9", "일반직", false, false, true, true),
      createEmployee("직원 10", "파견직", false, false, false, false),
      createEmployee("직원 11", "파견직", false, false, false, false),
      createEmployee("직원 12", "파견직", false, false, false, false)
    ];

    return {
      config: {
        startDate: toIsoDate(start),
        endDate: toIsoDate(end),
        holidays: [],
        targetOffDays: 8,
        maxConsecutive: 6,
        nGap: 5,
        minActive: 10,
        minEs: 8,
        fridayDs: 3,
        shuffleSeed: "",
        hProtection: true
      },
      employees,
      schedule: {},
      manual: {},
      ui: {
        panelCollapsed: false,
        editMode: "setup"
      }
    };
  }

  function createEmployee(name, group, plusOne = false, hPool = false, dPool = false, pPool = false, nwPool = false, mPool = false, mStandby = false) {
    return {
      id: `emp-${employeeSeed++}`,
      name,
      group,
      plusOne,
      nwPool,
      hPool,
      dPool,
      pPool,
      mPool,
      mStandby,
      past: ["", "", "", ""]
    };
  }

  function syncInputs() {
    const config = state.config;
    el.startDateInput.value = config.startDate;
    el.endDateInput.value = config.endDate;
    el.targetOffInput.value = config.targetOffDays;
    el.maxConsecutiveInput.value = config.maxConsecutive;
    el.shuffleSeedInput.value = config.shuffleSeed || "";
    syncHProtectionToggle();
    el.nGapInput.value = config.nGap;
    el.minActiveInput.value = config.minActive;
    el.minEsInput.value = config.minEs;
    el.fridayDsInput.value = config.fridayDs;
  }

  function pullConfigFromInputs() {
    state.config.startDate = el.startDateInput.value;
    state.config.endDate = el.endDateInput.value;
    state.config.targetOffDays = clampNumber(el.targetOffInput.value, 0, 31, 8);
    state.config.maxConsecutive = clampNumber(el.maxConsecutiveInput.value, 3, 10, 6);
    state.config.shuffleSeed = el.shuffleSeedInput.value.trim();
    state.config.nGap = clampNumber(el.nGapInput.value, 2, 10, 5);
    state.config.minActive = clampNumber(el.minActiveInput.value, 1, 30, 10);
    state.config.minEs = clampNumber(el.minEsInput.value, 1, 30, 8);
    state.config.fridayDs = clampNumber(el.fridayDsInput.value, 1, 10, 3);
  }

  function renderAll() {
    renderRolePalette();
    renderHolidays();
    renderEmployees();
    renderSchedule();
    renderStats();
    renderIssues(latestIssues);
    applyPanelState();
    applyModeState();
    updateSummary();
  }

  function syncHProtectionToggle() {
    const enabled = isHProtectionEnabled();
    el.hProtectionToggle.textContent = enabled ? "H 보호 활성화" : "H 보호 해제";
    el.hProtectionToggle.setAttribute("aria-pressed", String(enabled));
    el.hProtectionToggle.title = enabled ? "초기화와 자동생성에서 H 보호 로직을 적용합니다." : "초기화와 자동생성에서 H 보호 로직을 건너뜁니다.";
  }

  function applyPanelState() {
    const collapsed = Boolean(state.ui?.panelCollapsed);
    document.body.classList.toggle("panel-collapsed", collapsed);
    el.togglePanelButton.textContent = collapsed ? "☰ 설정 보이기" : "☰ 설정 숨기기";
    el.togglePanelButton.setAttribute("aria-expanded", String(!collapsed));
  }

  function applyModeState() {
    const forceMode = getEditMode() === "setup";
    document.body.classList.toggle("setup-mode", forceMode);
    document.body.classList.toggle("validate-mode", !forceMode);
    el.forceModeButton.classList.toggle("active", forceMode);
    el.validateModeButton.classList.toggle("active", !forceMode);
    el.forceModeButton.setAttribute("aria-pressed", String(forceMode));
    el.validateModeButton.setAttribute("aria-pressed", String(!forceMode));
    el.forceModeButton.title = "검증 위반 여부와 관계없이 인위적으로 배치합니다. N/W 세트 보호만 유지됩니다.";
    el.validateModeButton.title = "새 검증 문제가 생기는 배치는 제한됩니다.";
  }

  function setEditMode(mode) {
    state.ui ||= {};
    state.ui.editMode = mode === "validate" ? "validate" : "setup";
    dropCheckCache = new Map();
    clearDragHighlights();
    hideDragTooltip();
    applyModeState();
    renderSchedule();
    saveState();
    showNotice(getEditMode() === "setup" ? "강제배치 모드입니다. 검증 문제로는 배치를 막지 않습니다." : "검증배치 모드입니다. 새 검증 문제가 생기는 배치는 제한됩니다.");
  }

  function renderRolePalette() {
    el.rolePalette.replaceChildren();
    ROLE_MODULES.forEach(role => {
      const styleRole = role === "NW" ? "N" : role;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `role-chip ${role === "" ? "role-empty" : ""} ${selectedRole === role ? "active" : ""}`;
      chip.draggable = true;
      chip.dataset.role = role;
      chip.textContent = role || "비우기";
      chip.title = role === "NW" ? "N/W 세트 배치" : (role ? `${role} ${ROLE_DEFS[role].desc}` : "셀 비우기");
      applyRoleStyle(chip, styleRole);
      chip.addEventListener("click", () => {
        selectedRole = selectedRole === role ? null : role;
        renderRolePalette();
        showNotice(selectedRole === null ? "역할 선택을 해제했습니다." : `${role || "비우기"} 칠하기 모드`);
      });
      chip.addEventListener("dragstart", event => {
        dragPayload = { role, source: "palette" };
        dropCheckCache = new Map();
        event.dataTransfer.setData("text/plain", role);
        event.dataTransfer.setData("application/json", JSON.stringify(dragPayload));
        event.dataTransfer.effectAllowed = "copy";
        window.requestAnimationFrame(() => highlightDragTargets(dragPayload));
      });
      chip.addEventListener("dragend", () => {
        clearDragHighlights();
        dragPayload = null;
        dropCheckCache = new Map();
      });
      el.rolePalette.appendChild(chip);
    });
  }

  function renderHolidays() {
    el.holidayList.replaceChildren();
    state.config.holidays.sort().forEach(date => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = date;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "×";
      button.title = "삭제";
      button.addEventListener("click", () => {
        pushHistory("공휴일 삭제");
        state.config.holidays = state.config.holidays.filter(item => item !== date);
        renderAll();
        saveState();
      });
      tag.appendChild(button);
      el.holidayList.appendChild(tag);
    });
  }

  function renderEmployees() {
    el.employeeTableBody.replaceChildren();
    const movedEmployees = new Set(state.ui?.lastMovedEmployees || []);
    state.employees.forEach((employee, index) => {
      const tr = document.createElement("tr");
      tr.className = movedEmployees.has(employee.id) ? "row-moved" : "";
      tr.dataset.employeeIndex = String(index);
      tr.addEventListener("dragover", event => {
        if (employeeRowDragIndex === null || employeeRowDragIndex === index) return;
        event.preventDefault();
        const rect = tr.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        clearEmployeeDropPreview();
        tr.classList.toggle("row-insert-before", !after);
        tr.classList.toggle("row-insert-after", after);
        tr.dataset.dropPosition = after ? "after" : "before";
      });
      tr.addEventListener("dragleave", () => {
        tr.classList.remove("row-insert-before", "row-insert-after");
        delete tr.dataset.dropPosition;
      });
      tr.addEventListener("drop", event => {
        if (employeeRowDragIndex === null) return;
        event.preventDefault();
        const insertIndex = tr.dataset.dropPosition === "after" ? index + 1 : index;
        clearEmployeeDropPreview();
        moveEmployeeToInsertIndex(employeeRowDragIndex, insertIndex);
        employeeRowDragIndex = null;
      });
      tr.appendChild(inputCell(employee.name, value => { pushHistory("직원명 변경"); employee.name = value; renderSchedule(); renderStats(); saveState(); }));
      tr.appendChild(selectCell(GROUPS, employee.group, value => { pushHistory("직원 그룹 변경"); employee.group = value; latestIssues = validateSchedule(); renderSchedule(); renderStats(); renderIssues(latestIssues); saveState(); }));
      tr.appendChild(checkCell(employee.plusOne, value => { pushHistory("+1 변경"); employee.plusOne = value; renderStats(); saveState(); }));
      tr.appendChild(checkCell(employee.nwPool, value => { pushHistory("N/W풀 변경"); employee.nwPool = value; latestIssues = validateSchedule(); renderSchedule(); renderIssues(latestIssues); saveState(); }));
      tr.appendChild(checkCell(employee.hPool, value => { pushHistory("H풀 변경"); employee.hPool = value; saveState(); }));
      tr.appendChild(checkCell(employee.dPool, value => { pushHistory("D풀 변경"); employee.dPool = value; saveState(); }));
      tr.appendChild(checkCell(employee.pPool, value => { pushHistory("P풀 변경"); employee.pPool = value; saveState(); }));
      tr.appendChild(checkCell(employee.mPool, value => { pushHistory("M풀 변경"); employee.mPool = value; latestIssues = validateSchedule(); renderSchedule(); renderIssues(latestIssues); saveState(); }));
      tr.appendChild(checkCell(employee.mStandby, value => { pushHistory("M대기 변경"); employee.mStandby = value; latestIssues = validateSchedule(); renderSchedule(); renderIssues(latestIssues); saveState(); }));
      for (let p = 0; p < 4; p++) {
        tr.appendChild(roleSelectCell(employee.past[p], value => { pushHistory("이전달 데이터 변경"); employee.past[p] = value; latestIssues = validateSchedule(); renderSchedule(); renderIssues(latestIssues); saveState(); }));
      }
      const removeTd = document.createElement("td");
      removeTd.className = "staff-row-actions";
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "icon-button compact drag-handle";
      handle.textContent = "↕";
      handle.title = "끌어서 직원 순서 이동";
      handle.draggable = true;
      handle.addEventListener("dragstart", event => {
        employeeRowDragIndex = index;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
      });
      handle.addEventListener("dragend", () => {
        employeeRowDragIndex = null;
        clearEmployeeDropPreview();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button compact";
      remove.textContent = "×";
      remove.title = "직원 삭제";
      remove.addEventListener("click", () => {
        pushHistory("직원 삭제");
        state.employees.splice(index, 1);
        delete state.schedule[employee.id];
        Object.keys(state.manual).forEach(key => {
          if (key.startsWith(`${employee.id}|`)) delete state.manual[key];
        });
        renderAll();
        saveState();
      });
      removeTd.appendChild(handle);
      removeTd.appendChild(remove);
      tr.appendChild(removeTd);
      el.employeeTableBody.appendChild(tr);
    });
    syncStaffHorizontalScroll();
  }

  function bindStaffHorizontalScroll() {
    const staffWrap = document.querySelector(".staff-wrap");
    if (!staffWrap || !el.staffHorizontalScroll) return;

    staffWrap.addEventListener("scroll", () => {
      if (el.staffHorizontalScroll.scrollLeft !== staffWrap.scrollLeft) {
        el.staffHorizontalScroll.scrollLeft = staffWrap.scrollLeft;
      }
    });
    el.staffHorizontalScroll.addEventListener("scroll", () => {
      if (staffWrap.scrollLeft !== el.staffHorizontalScroll.scrollLeft) {
        staffWrap.scrollLeft = el.staffHorizontalScroll.scrollLeft;
      }
    });
    staffWrap.addEventListener("wheel", event => {
      if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      staffWrap.scrollLeft += event.deltaY;
    }, { passive: false });
    window.addEventListener("resize", syncStaffHorizontalScroll);
  }

  function syncStaffHorizontalScroll() {
    const staffWrap = document.querySelector(".staff-wrap");
    const table = staffWrap?.querySelector(".staff-table");
    if (!staffWrap || !table || !el.staffHorizontalScroll || !el.staffHorizontalScrollInner) return;

    el.staffHorizontalScrollInner.style.width = `${table.scrollWidth}px`;
    el.staffHorizontalScroll.scrollLeft = staffWrap.scrollLeft;
    el.staffHorizontalScroll.hidden = table.scrollWidth <= staffWrap.clientWidth + 1;
  }

  function clearPastColumn(index) {
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    const labels = ["D-4", "D-3", "D-2", "D-1"];
    const hasData = state.employees.some(employee => employee.past?.[index]);
    if (!hasData) {
      showNotice(`${labels[index]} 열은 이미 비어 있습니다.`);
      return;
    }

    pushHistory(`${labels[index]} 열 비우기`);
    state.employees.forEach(employee => {
      employee.past ||= ["", "", "", ""];
      employee.past[index] = "";
    });
    latestIssues = validateSchedule();
    renderEmployees();
    renderSchedule();
    renderStats();
    renderIssues(latestIssues);
    saveState();
    showNotice(`${labels[index]} 열을 공란으로 비웠습니다.`);
  }

  function moveEmployee(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.employees.length || fromIndex === toIndex) return;
    moveEmployeeToInsertIndex(fromIndex, toIndex);
  }

  function moveEmployeeToInsertIndex(fromIndex, insertIndex) {
    if (insertIndex < 0 || insertIndex > state.employees.length) return;
    let toIndex = insertIndex;
    if (fromIndex < insertIndex) toIndex--;
    if (fromIndex === toIndex) return;
    pushHistory("직원 순서 변경");
    const [employee] = state.employees.splice(fromIndex, 1);
    state.employees.splice(toIndex, 0, employee);
    state.ui ||= {};
    state.ui.lastMovedEmployees = [employee.id];
    renderAll();
    saveState();
    window.setTimeout(() => {
      const moved = state.ui?.lastMovedEmployees || [];
      if (!moved.includes(employee.id)) return;
      state.ui.lastMovedEmployees = [];
      renderEmployees();
      saveState();
    }, 1800);
  }

  function clearEmployeeDropPreview() {
    el.employeeTableBody.querySelectorAll(".row-insert-before, .row-insert-after").forEach(row => {
      row.classList.remove("row-insert-before", "row-insert-after");
      delete row.dataset.dropPosition;
    });
  }

  function renderSchedule() {
    const days = getScheduleDays();
    scheduleCellMap = new Map();
    employeeHeadMap = new Map();
    const lastChangedCells = new Set(state.ui?.lastChangedCells || []);
    const issueCells = new Set(latestIssues.filter(issue => issue.empId && issue.date).map(issue => keyOf(issue.empId, issue.date)));
    const issueDates = new Set(latestIssues.filter(issue => !issue.empId && issue.date).map(issue => issue.date));
    const issueMessagesByCell = latestIssues.reduce((map, issue) => {
      if (!issue.date) return map;
      const key = issue.empId ? keyOf(issue.empId, issue.date) : issue.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(`${issue.title}: ${issue.message}`);
      return map;
    }, new Map());
    el.scheduleTable.replaceChildren();

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const nameHead = document.createElement("th");
    nameHead.textContent = "직원 / 날짜";
    headRow.appendChild(nameHead);

    days.forEach(day => {
      const dateKey = toIsoDate(day);
      const th = document.createElement("th");
      th.className = `date-head ${isWeekend(day) ? "weekend" : ""} ${isHoliday(day) ? "holiday" : ""}`;
      const dateSpan = document.createElement("span");
      dateSpan.className = "date-number";
      dateSpan.textContent = `${day.getMonth() + 1}/${day.getDate()} (${weekdayName(day)})`;
      const countSpan = document.createElement("span");
      countSpan.className = "summary-count";
      countSpan.textContent = `E+S ${countDayRoles(dateKey, ["E", "S"])}`;
      th.append(dateSpan, countSpan);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    state.employees.forEach(employee => {
      const row = document.createElement("tr");
      const head = document.createElement("td");
      head.className = "employee-head";
      const name = document.createElement("strong");
      name.textContent = employee.name || "이름 없음";
      const meta = document.createElement("span");
      meta.className = "rest-count";
      meta.textContent = String(countEmployeeRest(employee.id, days));
      head.append(name, meta);
      head.dataset.employeeId = employee.id;
      employeeHeadMap.set(employee.id, head);
      row.appendChild(head);

      days.forEach(day => {
        const dateKey = toIsoDate(day);
        const role = getRole(employee.id, dateKey);
        const td = document.createElement("td");
        const cellKey = keyOf(employee.id, dateKey);
        const hasCellIssue = issueCells.has(cellKey);
        const hasDateIssue = issueDates.has(dateKey);
        const wasLastChanged = lastChangedCells.has(cellKey);
        td.className = `schedule-cell ${isWeekend(day) || isHoliday(day) ? "weekend" : ""} ${hasDateIssue ? "issue-date" : ""} ${hasCellIssue ? "issue-employee" : ""} ${wasLastChanged ? "last-changed" : ""}`;
        if (hasCellIssue || hasDateIssue) {
          const messages = [
            ...(issueMessagesByCell.get(cellKey) || []),
            ...(issueMessagesByCell.get(dateKey) || [])
          ];
          td.dataset.issueTitle = messages.slice(0, 6).join("\n");
          td.setAttribute("aria-label", td.dataset.issueTitle);
          td.addEventListener("mouseenter", event => {
            if (!dragPayload) showIssueTooltip(td.dataset.issueTitle, event);
          });
          td.addEventListener("mousemove", event => {
            if (!dragPayload) moveIssueTooltip(event);
          });
          td.addEventListener("mouseleave", hideIssueTooltip);
        }
        td.dataset.employeeId = employee.id;
        td.dataset.date = dateKey;
        scheduleCellMap.set(keyOf(employee.id, dateKey), td);
        td.addEventListener("dragover", event => {
          const payload = readDragPayload(event);
          const result = payload ? quickCanPreviewDrop(payload, employee.id, dateKey) : { ok: false, reason: "근무 모듈을 먼저 선택하세요." };
          td.classList.toggle("drag-over", result.ok);
          if (result.ok) event.preventDefault();
          if (result.ok) {
            showActiveDropPreview(payload, employee.id, dateKey);
            hideDragTooltip();
            hideIssueTooltip();
          } else {
            clearActiveDropPreview();
            td.title = result.reason;
            showDragTooltip(result.reason, event);
            hideIssueTooltip();
          }
        });
        td.addEventListener("dragleave", () => {
          td.classList.remove("drag-over");
          clearActiveDropPreview();
          td.removeAttribute("title");
          hideDragTooltip();
          hideIssueTooltip();
        });
        td.addEventListener("drop", event => {
          event.preventDefault();
          td.classList.remove("drag-over");
          clearActiveDropPreview();
          hideDragTooltip();
          hideIssueTooltip();
          const payload = readDragPayload(event);
          if (payload) applyDrop(payload, employee.id, dateKey);
        });
        td.addEventListener("mousedown", event => {
          if (event.button !== 0 || selectedRole === null) return;
          event.preventDefault();
          startPainting();
          paintCell(employee.id, dateKey);
        });
        td.addEventListener("mouseenter", () => {
          if (isPainting && selectedRole !== null) paintCell(employee.id, dateKey);
        });
        td.addEventListener("contextmenu", event => {
          event.preventDefault();
          showCellContextMenu(employee.id, dateKey, event.clientX, event.clientY);
        });
        td.addEventListener("dblclick", () => setRole(employee.id, dateKey, "", true, { enforce: true }));
        td.appendChild(createCellChip(role, employee.id, dateKey));
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });

    el.scheduleTable.append(thead, tbody);
  }

  function createCellChip(role, employeeId, date) {
    const chip = document.createElement("span");
    chip.className = `cell-chip ${role ? "" : "empty"}`;
    chip.textContent = role || "·";
    chip.draggable = true;
    chip.dataset.role = role;
    chip.title = role ? `${role} ${ROLE_DEFS[role]?.desc || ""}` : "빈 셀";
    applyRoleStyle(chip, role);
    chip.addEventListener("dragstart", event => {
      dragPayload = createCellDragPayload(role, employeeId, date);
      dropCheckCache = new Map();
      event.dataTransfer.setData("text/plain", role);
      event.dataTransfer.setData("application/json", JSON.stringify(dragPayload));
      event.dataTransfer.effectAllowed = "copy";
      window.requestAnimationFrame(() => highlightDragTargets(dragPayload));
    });
    chip.addEventListener("dragend", () => {
      clearDragHighlights();
      hideDragTooltip();
      dragPayload = null;
      dropCheckCache = new Map();
    });
    return chip;
  }

  function renderStats() {
    el.statsGrid.replaceChildren();
    const days = getScheduleDays();
    renderDailyStats(days);
    state.employees.forEach(employee => {
      const counts = {};
      Object.keys(ROLE_DEFS).forEach(role => { counts[role] = 0; });
      days.forEach(day => {
        const role = getRole(employee.id, toIsoDate(day));
        if (counts[role] !== undefined) counts[role]++;
      });
      const card = document.createElement("article");
      card.className = "stat-card";
      const title = document.createElement("h3");
      title.textContent = employee.name;
      card.appendChild(title);
      [
        ["휴무 X+R", `${counts.X + counts.R} / ${getTargetOff(employee)}`],
        ["N", counts.N],
        ["H", counts.H],
        ["D", counts.D],
        ["P", counts.P],
        ["E+S", counts.E + counts.S]
      ].forEach(([label, value]) => {
        const line = document.createElement("div");
        line.className = "stat-line";
        line.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
        card.appendChild(line);
      });
      el.statsGrid.appendChild(card);
    });
  }

  function countEmployeeRest(employeeId, days) {
    return days.reduce((sum, day) => {
      const role = getRole(employeeId, toIsoDate(day));
      return sum + (role === "X" || role === "R" ? 1 : 0);
    }, 0);
  }

  function renderDailyStats(days) {
    const card = document.createElement("article");
    card.className = "stat-card daily-stat-card";
    const title = document.createElement("h3");
    title.textContent = "일별 통계";
    card.appendChild(title);

    const wrap = document.createElement("div");
    wrap.className = "daily-stat-wrap";
    const table = document.createElement("table");
    table.className = "daily-stat-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>날짜</th>
          <th>일반+전문 휴무</th>
          <th>파견 휴무</th>
          <th>E+S 노말</th>
          <th>총 근무자</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");

    days.forEach(day => {
      const dateKey = toIsoDate(day);
      let generalRest = 0;
      let dispatchRest = 0;
      let normalWorkers = 0;
      let totalWorkers = 0;

      state.employees.forEach(employee => {
        const role = getRole(employee.id, dateKey);
        if (REST_ROLES.includes(role)) {
          if (employee.group === "파견직") dispatchRest++;
          else generalRest++;
        }
        if (["E", "S"].includes(role)) normalWorkers++;
        if (isWorkingRole(role)) totalWorkers++;
      });

      const tr = document.createElement("tr");
      if (isRedDay(day)) tr.className = "red-day-row";
      [
        `${dateKey} (${weekdayName(day)})`,
        generalRest,
        dispatchRest,
        normalWorkers,
        totalWorkers
      ].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    el.statsGrid.appendChild(card);
  }

  function renderIssues(issues) {
    el.issueList.replaceChildren();
    if (!issues.length) {
      const ok = document.createElement("article");
      ok.className = "issue-card ok";
      ok.innerHTML = "<h3>검증 통과</h3><p>현재 확인 가능한 규칙 위반이 없습니다.</p>";
      el.issueList.appendChild(ok);
      return;
    }
    issues.slice(0, 80).forEach(issue => {
      const card = document.createElement("article");
      card.className = "issue-card";
      const title = document.createElement("h3");
      title.textContent = issue.title;
      const body = document.createElement("p");
      body.textContent = issue.message;
      card.append(title, body);
      el.issueList.appendChild(card);
    });
  }

  function generateSchedule() {
    const days = getScheduleDays();
    const employees = state.employees;
    const data = employees.map(() => new Array(days.length).fill(""));
    const assignedByDay = days.map(() => new Set());
    const restCounts = employees.map(() => 0);
    const workCounts = employees.map(() => 0);
    const consecutive = employees.map((employee) => getPastConsecutive(employee));
    const pointers = { N: 0, D: 0, E: 0, E_DISP: 0, H: 0, M1: 0, M2: 0, M3: 0, P: 0 };

    for (let d = 0; d < days.length; d++) {
      const dateKey = toIsoDate(days[d]);
      for (let i = 0; i < employees.length; i++) {
        const role = getRole(employees[i].id, dateKey);
        const isManual = state.manual[keyOf(employees[i].id, dateKey)];
        const isProtectedManual = isManual && (!isMRole(role) || isManualRoleAllowed(employees[i].id, dateKey, role));
        const isProtected = isProtectedManual || (d === 0 && role === "W");
        if (role && isProtected) {
          data[i][d] = role;
          assignedByDay[d].add(i);
          if (role === "X" || role === "R") restCounts[i]++;
          if (isWorkingRole(role)) workCounts[i]++;
        }
      }
    }

    generateNightSchedule({ data, days, employees, assignedByDay, restCounts, workCounts, consecutive, pointers }, getNightPool());

    for (let d = 0; d < days.length; d++) {
      const day = days[d];
      const redDay = isRedDay(day);
      const sunday = day.getDay() === 0;
      const weekend = isWeekend(day);
      const monToThu = day.getDay() >= 1 && day.getDay() <= 4;
      const pools = getPools();

      for (let i = 0; i < employees.length; i++) {
        if (assignedByDay[d].has(i)) continue;
        const prev = d === 0 ? employees[i].past[3] : data[i][d - 1];
        if (prev === "N") {
          data[i][d] = "W";
          assignedByDay[d].add(i);
        } else if (d === 0 && prev === "W") {
          data[i][d] = "R";
          assignedByDay[d].add(i);
          restCounts[i]++;
        }
      }

      const dayContext = { data, d, days, employees, assignedByDay, restCounts, workCounts, consecutive, pointers };
      protectAfterWakeRest(data, d, employees, assignedByDay[d], restCounts);
      assignRole(dayContext, pools.d.length ? pools.d : pools.standard, "D");
      assignRole(dayContext, getNormalEPool(pools), "E", redDay, "E");
      assignRole(dayContext, pools.dispatch, "E", redDay, "E_DISP");
      assignRole(dayContext, pools.h.length ? pools.h : pools.standard, "H", sunday);
      assignMRole(dayContext, "M1");
      assignMRole(dayContext, "M2", redDay);
      assignMRole(dayContext, "M3", !monToThu);
      assignRole(dayContext, pools.p.length ? pools.p : pools.standard, "P", weekend || hasRoleOnDay(data, d, "P"));

      if (redDay) {
        fillRedDay(data, d, employees, assignedByDay[d], restCounts, workCounts, consecutive, day, sunday);
      } else {
        for (let i = 0; i < employees.length; i++) {
          if (!assignedByDay[d].has(i) && consecutive[i] >= state.config.maxConsecutive) {
            data[i][d] = "R";
            assignedByDay[d].add(i);
            restCounts[i]++;
          }
        }
        for (let i = 0; i < employees.length; i++) {
          if (!assignedByDay[d].has(i)) {
            data[i][d] = "S";
            assignedByDay[d].add(i);
            workCounts[i]++;
          }
        }
      }

      for (let i = 0; i < employees.length; i++) {
        if (isRestRole(data[i][d])) consecutive[i] = 0;
        else consecutive[i]++;
      }
    }

    rebalanceTargetOff(data, days, employees);
    rebalanceTargetOffBySwaps(data, days, employees);
    enforceMaxConsecutive(data, days, employees);
    relieveMCoreWithStandby(data, days, employees);
    forceExactTargetOff(data, days, employees);
    repairMissingMRoles(data, days, employees);
    relieveMCoreWithStandby(data, days, employees);
    forceExactTargetOff(data, days, employees);
    writeDataToState(data, days, employees);
    showNotice("자동 생성이 끝났습니다. 검증 탭에서 위반 항목을 확인할 수 있습니다.");
  }

  function assignRole(ctx, pool, role, skip = false, pointerKey = role, options = {}) {
    if (skip || !pool.length) return false;
    const { data, d, days, employees, assignedByDay, workCounts, consecutive, pointers } = ctx;
    const assigned = assignedByDay[d];
    const uniqueRoles = ["N", "D", "H", "M1", "M2", "M3", "P"];
    if (uniqueRoles.includes(role) && hasRoleOnDay(data, d, role)) return false;

    let candidates = pool.filter(i => !assigned.has(i) && isEligibleForRole(data, days, employees, i, d, role, consecutive[i]));
    if (!candidates.length && role !== "E" && options.allowRelaxedFallback !== false) {
      candidates = getPools().standard.filter(i => !assigned.has(i) && isEligibleForRole(data, days, employees, i, d, role, consecutive[i], true));
    }
    if (!candidates.length) return false;
    if (role === "N") {
      candidates = filterNightCandidatesByWeekendFairness(candidates, data, days, employees, d);
    }

    candidates.sort((a, b) => {
      if (role === "N") {
        const burdenDiff = getWeekendNWPenalty(data, days, employees, a, d) - getWeekendNWPenalty(data, days, employees, b, d);
        if (burdenDiff !== 0) return burdenDiff;
        const gapDiff = daysSinceLastRole(data, employees, b, d, "N") - daysSinceLastRole(data, employees, a, d, "N");
        if (gapDiff !== 0) return gapDiff;
      }

      const sameRoleDiff = countEmployeeRole(data, a, role, d) - countEmployeeRole(data, b, role, d);
      if (sameRoleDiff !== 0) return sameRoleDiff;
      const criticalDiff = countCritical(data, a, d) - countCritical(data, b, d);
      if (criticalDiff !== 0) return criticalDiff;
      const streakDiff = consecutive[a] - consecutive[b];
      if (streakDiff !== 0) return streakDiff;
      return pointerDistance(pool, pointers[pointerKey] || 0, a) - pointerDistance(pool, pointers[pointerKey] || 0, b);
    });

    const selected = candidates[0];
    data[selected][d] = role;
    assigned.add(selected);
    workCounts[selected]++;
    const pos = pool.indexOf(selected);
    if (pos !== -1) pointers[pointerKey] = (pos + 1) % pool.length;
    return true;
  }

  function assignMRole(ctx, role, skip = false) {
    if (skip) return false;
    const pools = getPools();
    const primary = pools.m.length ? pools.m : (pools.mStandby.length ? [] : pools.standard);
    if (assignRole(ctx, primary, role, false, role, { allowRelaxedFallback: false })) return true;
    if (!pools.mStandby.length) return false;
    return assignRole(ctx, pools.mStandby, role, false, role, { allowRelaxedFallback: false });
  }

  function getNormalEPool(pools = getPools()) {
    const filtered = pools.standard.filter(index => !state.employees[index].mPool);
    return pools.m.length ? filtered : pools.standard;
  }

  function protectAfterWakeRest(data, d, employees, assigned, restCounts) {
    if (d <= 0) return;
    for (let i = 0; i < employees.length; i++) {
      if (assigned.has(i)) continue;
      if (data[i][d - 1] !== "W") continue;
      data[i][d] = "R";
      assigned.add(i);
      restCounts[i]++;
    }
  }

  function generateNightSchedule(ctx, standardPool) {
    const { data, days, employees } = ctx;
    const standard = seededShuffle(standardPool.length ? standardPool : employees.map((_, index) => index), `${getScheduleSeed()}|night|standard`);
    const allEmployees = seededShuffle(getPools().nw.length ? standard : employees.map((_, index) => index), `${getScheduleSeed()}|night|all`);
    const nightOrder = days
      .map((day, d) => ({ d, pattern: getWeekendNWPattern(day) }))
      .sort((a, b) => {
        const aPriority = a.pattern ? 0 : 1;
        const bPriority = b.pattern ? 0 : 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.d - b.d;
      });

    nightOrder.forEach(({ d }) => {
      if (hasRoleOnDay(data, d, "N")) {
        ensureWakeAfterExistingNight(ctx, d);
        return;
      }
      const selected = selectNightCandidate(ctx, d, standard) ?? selectNightCandidate(ctx, d, allEmployees, true);
      if (selected !== null) assignNightPair(ctx, selected, d);
    });

    repairWeekendNWRepeats(ctx, standard);

    days.forEach((_, d) => {
      if (!hasRoleOnDay(data, d, "N")) forceNightDuty({ ...ctx, d }, standard);
    });

    repairNightWakeAlternations(ctx, standard);
  }

  function selectNightCandidate(ctx, d, pool, relaxed = false) {
    const { data, days, employees } = ctx;
    const phases = relaxed
      ? [
          { gap: 2, avoidSamePattern: true, avoidRecent: false, standardOnly: false },
          { gap: 0, avoidSamePattern: false, avoidRecent: false, standardOnly: false }
        ]
      : [
          { gap: state.config.nGap, avoidSamePattern: true, avoidRecent: true, standardOnly: true },
          { gap: state.config.nGap, avoidSamePattern: true, avoidRecent: false, standardOnly: true },
          { gap: 3, avoidSamePattern: true, avoidRecent: false, standardOnly: true },
          { gap: 0, avoidSamePattern: false, avoidRecent: false, standardOnly: true }
        ];

    for (const phase of phases) {
      const candidates = pool
        .filter(index => canAssignNightPair(ctx, index, d, phase))
        .map(index => ({ index, cost: getNightAssignmentCost(data, days, employees, index, d) }))
        .sort((a, b) => a.cost - b.cost);
      if (candidates.length) return candidates[0].index;
    }
    return null;
  }

  function canAssignNightPair(ctx, index, d, phase) {
    const { data, days, employees, assignedByDay } = ctx;
    const employee = employees[index];
    const dateKey = toIsoDate(days[d]);
    if (getPools().nw.length && !employee.nwPool) return false;
    if (!getPools().nw.length && employee.group === "파견직") return false;
    if (assignedByDay[d].has(index)) return false;
    if (isProtectedScheduleCell(employee.id, dateKey, data[index][d])) return false;
    if (d > 0 && data[index][d - 1] === "N") return false;
    if (d > 0 && data[index][d - 1] === "W") return false;
    if (d === 0 && employee.past[3] === "N") return false;
    if (d === 0 && employee.past[3] === "W") return false;
    if (phase.gap > 0 && hasNearbyRole(data, employees, index, d, "N", phase.gap)) return false;
    if (hasRecentNightWakePair(data, employees, index, d, 3)) return false;
    if (hasFutureNightWakePair(data, index, d, 3)) return false;

    const pattern = getWeekendNWPattern(days[d]);
    if (pattern && phase.avoidSamePattern && countWeekendNWPattern(data, days, index, d, pattern) > 0) return false;
    if (pattern && phase.avoidRecent && countRecentWeekendNW(data, days, index, d, 8) > 0) return false;

    if (d + 1 < days.length) {
      const wakeDate = toIsoDate(days[d + 1]);
      const wakeRole = data[index][d + 1];
      if (assignedByDay[d + 1].has(index)) return false;
      if (isProtectedScheduleCell(employee.id, wakeDate, wakeRole)) return false;
    }
    return true;
  }

  function getNightAssignmentCost(data, days, employees, index, d) {
    const pattern = getWeekendNWPattern(days[d]);
    let cost = 0;
    if (!getPools().nw.length && employees[index].group === "파견직") cost += 1000000;
    if (pattern) {
      cost += countWeekendNWPattern(data, days, index, d, pattern) * 100000;
      cost += countRecentWeekendNW(data, days, index, d, 8) * 50000;
      cost += countWeekendNWTotal(data, days, index, d) * 25000;
    }
    cost += countEmployeeRole(data, index, "N", d) * 9000;
    cost -= Math.min(daysSinceLastRole(data, employees, index, d, "N"), 30) * 100;
    cost += seededNoise(`${getScheduleSeed()}|N|${employees[index].id}|${toIsoDate(days[d])}`) * 250;
    return cost;
  }

  function assignNightPair(ctx, index, d) {
    const { data, days, employees, assignedByDay, workCounts, pointers } = ctx;
    data[index][d] = "N";
    assignedByDay[d].add(index);
    workCounts[index]++;
    const nightPool = getNightPool();
    const pos = nightPool.indexOf(index);
    if (pos !== -1) pointers.N = (pos + 1) % nightPool.length;

    if (d + 1 < days.length) {
      const wakeDate = toIsoDate(days[d + 1]);
      if (!isProtectedScheduleCell(employees[index].id, wakeDate, data[index][d + 1]) && !assignedByDay[d + 1].has(index)) {
        data[index][d + 1] = "W";
        assignedByDay[d + 1].add(index);
      }
    }
  }

  function ensureWakeAfterExistingNight(ctx, d) {
    const { data, days, employees, assignedByDay } = ctx;
    if (d + 1 >= days.length) return;
    const nightIndex = data.findIndex(row => row[d] === "N");
    if (nightIndex === -1) return;
    const wakeDate = toIsoDate(days[d + 1]);
    if (isProtectedScheduleCell(employees[nightIndex].id, wakeDate, data[nightIndex][d + 1])) return;
    if (assignedByDay[d + 1].has(nightIndex)) return;
    data[nightIndex][d + 1] = "W";
    assignedByDay[d + 1].add(nightIndex);
  }

  function repairWeekendNWRepeats(ctx, standardPool) {
    const { data, days, employees, assignedByDay, workCounts } = ctx;
    const standard = standardPool.length ? standardPool : employees.map((_, index) => index);
    const patternOwners = new Map();

    for (let d = 0; d < days.length; d++) {
      const pattern = getWeekendNWPattern(days[d]);
      if (!pattern) continue;
      for (let i = 0; i < employees.length; i++) {
        if (data[i][d] !== "N") continue;
        const mapKey = `${i}|${pattern}`;
        const previous = patternOwners.get(mapKey) || [];
        previous.push(d);
        patternOwners.set(mapKey, previous);
      }
    }

    patternOwners.forEach((dates, key) => {
      if (dates.length <= 1) return;
      const [employeeIndexText] = key.split("|");
      const sourceIndex = Number(employeeIndexText);
      dates.slice(1).forEach(d => {
        const dateKey = toIsoDate(days[d]);
        if (isProtectedScheduleCell(employees[sourceIndex].id, dateKey, data[sourceIndex][d])) return;
        const replacement = standard
          .filter(index => index !== sourceIndex)
          .filter(index => countWeekendNWPattern(data, days, index, d, getWeekendNWPattern(days[d])) === 0)
          .map(index => ({ index, cost: getNightAssignmentCost(data, days, employees, index, d) }))
          .sort((a, b) => a.cost - b.cost)
          .find(item => canMoveNightPair(ctx, sourceIndex, item.index, d));
        if (replacement) moveNightPair(ctx, sourceIndex, replacement.index, d);
      });
    });

    function canMoveNightPair(context, sourceIndex, targetIndex, d) {
      temporarilyClearNightPair(context, sourceIndex, d);
      const canMove = canAssignNightPair(context, targetIndex, d, { gap: 2, avoidSamePattern: true, avoidRecent: false, standardOnly: true });
      restoreNightPair(context, sourceIndex, d);
      return canMove;
    }

    function moveNightPair(context, sourceIndex, targetIndex, d) {
      temporarilyClearNightPair(context, sourceIndex, d);
      workCounts[sourceIndex] = Math.max(0, workCounts[sourceIndex] - 1);
      assignNightPair(context, targetIndex, d);
    }

    function temporarilyClearNightPair(context, sourceIndex, d) {
      data[sourceIndex][d] = "";
      assignedByDay[d].delete(sourceIndex);
      if (d + 1 < days.length && data[sourceIndex][d + 1] === "W" && !isProtectedScheduleCell(employees[sourceIndex].id, toIsoDate(days[d + 1]), "W")) {
        data[sourceIndex][d + 1] = "";
        assignedByDay[d + 1].delete(sourceIndex);
      }
    }

    function restoreNightPair(context, sourceIndex, d) {
      data[sourceIndex][d] = "N";
      assignedByDay[d].add(sourceIndex);
      if (d + 1 < days.length && !data[sourceIndex][d + 1]) {
        data[sourceIndex][d + 1] = "W";
        assignedByDay[d + 1].add(sourceIndex);
      }
    }
  }

  function repairNightWakeAlternations(ctx, standardPool) {
    const { data, days, employees, assignedByDay, workCounts } = ctx;
    const standard = standardPool.length ? standardPool : employees.map((_, index) => index);
    const allEmployees = getPools().nw.length ? standard : employees.map((_, index) => index);
    let changed = true;
    let passes = 0;

    while (changed && passes < 20) {
      changed = false;
      passes++;

      for (let sourceIndex = 0; sourceIndex < employees.length; sourceIndex++) {
        for (let d = 0; d < days.length; d++) {
          if (data[sourceIndex][d] !== "N") continue;
          const conflictDay = findNextNightWithin(data, sourceIndex, d, 3);
          if (conflictDay === -1) continue;
          if (isProtectedScheduleCell(employees[sourceIndex].id, toIsoDate(days[conflictDay]), "N")) continue;

          const replacement = findNightRepairReplacement(sourceIndex, conflictDay);
          if (replacement === null) continue;

          temporarilyClearNightPair(sourceIndex, conflictDay);
          workCounts[sourceIndex] = Math.max(0, workCounts[sourceIndex] - 1);
          assignNightPair(ctx, replacement, conflictDay);
          changed = true;
          break;
        }
        if (changed) break;
      }
    }

    function findNightRepairReplacement(sourceIndex, d) {
      const pools = [
        { list: standard, standardOnly: true },
        { list: allEmployees, standardOnly: false }
      ];

      for (const pool of pools) {
        const candidates = pool.list
          .filter(index => index !== sourceIndex)
          .filter(index => canAssignNightPair(ctx, index, d, {
            gap: 2,
            avoidSamePattern: true,
            avoidRecent: false,
            standardOnly: pool.standardOnly
          }))
          .map(index => ({ index, cost: getNightAssignmentCost(data, days, employees, index, d) }))
          .sort((a, b) => a.cost - b.cost);
        if (candidates.length) return candidates[0].index;
      }
      return null;
    }

    function temporarilyClearNightPair(sourceIndex, d) {
      data[sourceIndex][d] = "";
      assignedByDay[d].delete(sourceIndex);
      if (d + 1 < days.length && data[sourceIndex][d + 1] === "W" && !isProtectedScheduleCell(employees[sourceIndex].id, toIsoDate(days[d + 1]), "W")) {
        data[sourceIndex][d + 1] = "";
        assignedByDay[d + 1].delete(sourceIndex);
      }
    }
  }

  function ensureNightDuty(ctx, standardPool) {
    if (hasRoleOnDay(ctx.data, ctx.d, "N")) return true;
    if (assignRole(ctx, standardPool, "N")) return true;
    return forceNightDuty(ctx, standardPool);
  }

  function filterNightCandidatesByWeekendFairness(candidates, data, days, employees, currentDay) {
    const pattern = getWeekendNWPattern(days[currentDay]);
    if (!pattern || candidates.length <= 1) return candidates;

    const withoutSamePattern = candidates.filter(index => countWeekendNWPattern(data, days, index, currentDay, pattern) === 0);
    if (withoutSamePattern.length) candidates = withoutSamePattern;

    const withoutRecentWeekend = candidates.filter(index => countRecentWeekendNW(data, days, index, currentDay, 8) === 0);
    if (withoutRecentWeekend.length) candidates = withoutRecentWeekend;

    const minTotal = Math.min(...candidates.map(index => countWeekendNWTotal(data, days, index, currentDay)));
    const lowestTotal = candidates.filter(index => countWeekendNWTotal(data, days, index, currentDay) === minTotal);
    return lowestTotal.length ? lowestTotal : candidates;
  }

  function forceNightDuty(ctx, standardPool) {
    const { data, d, days, employees, assignedByDay, restCounts, workCounts, consecutive, pointers } = ctx;
    const assigned = assignedByDay[d];
    const dateKey = toIsoDate(days[d]);
    const primaryPool = standardPool.length ? standardPool : employees.map((_, index) => index);
    const allEmployees = getPools().nw.length ? primaryPool : employees.map((_, index) => index);
    const candidatePlans = [
      { pool: primaryPool, avoidNightWakeWindow: true, avoidAssigned: true, avoidWakeConflict: true },
      { pool: allEmployees, avoidNightWakeWindow: true, avoidAssigned: true, avoidWakeConflict: true },
      { pool: primaryPool, avoidNightWakeWindow: true, avoidAssigned: false, avoidWakeConflict: true },
      { pool: allEmployees, avoidNightWakeWindow: true, avoidAssigned: false, avoidWakeConflict: true },
      { pool: primaryPool, avoidNightWakeWindow: false, avoidAssigned: true, avoidWakeConflict: true },
      { pool: allEmployees, avoidNightWakeWindow: false, avoidAssigned: true, avoidWakeConflict: true },
      { pool: primaryPool, avoidNightWakeWindow: false, avoidAssigned: false, avoidWakeConflict: false },
      { pool: allEmployees, avoidNightWakeWindow: false, avoidAssigned: false, avoidWakeConflict: false }
    ];
    let candidates = [];

    for (const plan of candidatePlans) {
      candidates = buildForcedNightCandidates(plan.pool, plan);
      if (candidates.length) break;
    }

    if (!candidates.length) return false;

    const selected = candidates[0].index;
    const oldRole = data[selected][d];
    if (oldRole === "X" || oldRole === "R") restCounts[selected] = Math.max(0, restCounts[selected] - 1);
    if (isWorkingRole(oldRole)) workCounts[selected] = Math.max(0, workCounts[selected] - 1);

    data[selected][d] = "N";
    assigned.add(selected);
    workCounts[selected]++;

    if (d + 1 < days.length) {
      const wakeDate = toIsoDate(days[d + 1]);
      if (!isProtectedScheduleCell(employees[selected].id, wakeDate, data[selected][d + 1]) && !assignedByDay[d + 1].has(selected)) {
        data[selected][d + 1] = "W";
        assignedByDay[d + 1].add(selected);
      }
    }

    const pos = primaryPool.indexOf(selected);
    if (pos !== -1) pointers.N = (pos + 1) % primaryPool.length;
    return true;

    function buildForcedNightCandidates(pool, options) {
      return pool
        .filter(index => getPools().nw.length ? employees[index].nwPool : employees[index].group !== "파견직")
        .filter(index => !isProtectedScheduleCell(employees[index].id, dateKey, data[index][d]))
        .filter(index => !options.avoidAssigned || !assigned.has(index))
        .filter(index => !options.avoidNightWakeWindow || !hasRecentNightWakePair(data, employees, index, d, 3))
        .filter(index => !options.avoidNightWakeWindow || !hasFutureNightWakePair(data, index, d, 3))
        .filter(index => {
          if (!options.avoidWakeConflict || d + 1 >= days.length) return true;
          const wakeDate = toIsoDate(days[d + 1]);
          const wakeRole = data[index][d + 1];
          if (assignedByDay[d + 1].has(index)) return false;
          if (isProtectedScheduleCell(employees[index].id, wakeDate, wakeRole)) return false;
          return !["X", "A", "P", "N"].includes(wakeRole);
        })
        .map(index => {
        const currentRole = data[index][d];
        const prevRole = d === 0 ? employees[index].past[3] : data[index][d - 1];
        const tomorrowRole = getRole(employees[index].id, toIsoDate(addDays(days[d], 1)));
        let score = 0;

        if (assigned.has(index)) score += 800;
        if (currentRole === "W") score += 500;
        if (currentRole && currentRole !== "S" && currentRole !== "R") score += 180;
        if (employees[index].group === "파견직") score += 5000;
        if (prevRole === "N") score += 3000;
        if (prevRole === "W") score += 200000;
        if (hasRecentNightWakePair(data, employees, index, d, 3)) score += 200000;
        if (hasFutureNightWakePair(data, index, d, 3)) score += 200000;
        if (hasNearbyRole(data, employees, index, d, "N", state.config.nGap)) score += 1200;
        if (["X", "A", "P", "N"].includes(tomorrowRole)) score += 900;
        score += getWeekendNWPenalty(data, days, employees, index, d) * 3;
        score += Math.max(0, consecutive[index] - state.config.maxConsecutive + 1) * 700;
        score += countEmployeeRole(data, index, "N", d) * 60;
        score -= daysSinceLastRole(data, employees, index, d, "N");

        return { index, score };
      })
      .sort((a, b) => a.score - b.score);
    }
  }

  function isEligibleForRole(data, days, employees, idx, d, role, streak, relaxed = false) {
    const employee = employees[idx];
    const pools = getPools();
    if (role === "N" && pools.nw.length && !employee.nwPool) return false;
    if (role === "N" && !pools.nw.length && employee.group === "파견직") return false;
    if (role === "H" && pools.h.length && !employee.hPool) return false;
    if (role === "D" && pools.d.length && !employee.dPool) return false;
    if (role === "P" && pools.p.length && !employee.pPool) return false;
    if (["M1", "M2", "M3"].includes(role) && (pools.m.length || pools.mStandby.length) && !employee.mPool && !employee.mStandby) return false;
    if (!relaxed) {
      if (["M1", "M2", "M3"].includes(role) && employee.group === "파견직") return false;
    }
    if (role === "N") {
      if (streak >= state.config.maxConsecutive - 1) return false;
      if ((d > 0 && data[idx][d - 1] === "N") || (d === 0 && employee.past[3] === "N")) return false;
      if (hasNearbyRole(data, employees, idx, d, "N", state.config.nGap)) return false;
      const tomorrow = getRole(employee.id, toIsoDate(addDays(days[d], 1)));
      if (["X", "A", "P", "N"].includes(tomorrow)) return false;
    } else if (streak >= state.config.maxConsecutive) {
      return false;
    }
    if (role === "H") {
      const prev = d === 0 ? employee.past[3] : data[idx][d - 1];
      if (!relaxed && !canPrecedeH(prev)) return false;
    }
    return true;
  }

  function fillRedDay(data, d, employees, assigned, restCounts, workCounts, consecutive, day, sunday) {
    const currentGeneralDs = countGeneralDs(data, employees, d);
    const standardNeed = isWeekend(day) ? Math.max(0, state.config.fridayDs - currentGeneralDs) : 1;
    const dispatchNeed = sunday ? 2 : 3;
    const pools = getPools();
    selectRedDayWorkers(pools.standard, standardNeed);
    selectRedDayWorkers(pools.dispatch, dispatchNeed);
    for (let i = 0; i < employees.length; i++) {
      if (!assigned.has(i)) {
        data[i][d] = "R";
        assigned.add(i);
        restCounts[i]++;
      }
    }

    function selectRedDayWorkers(pool, needed) {
      const candidates = pool.filter(i => !assigned.has(i) && consecutive[i] < state.config.maxConsecutive)
        .map(i => ({ i, score: restCounts[i] * 1000 - workCounts[i] + weekendFairnessScore(data, i, d) }))
        .sort((a, b) => b.score - a.score);
      candidates.slice(0, needed).forEach(item => {
        data[item.i][d] = "S";
        assigned.add(item.i);
        workCounts[item.i]++;
      });
    }
  }

  function countGeneralDs(data, employees, d) {
    let count = 0;
    for (let i = 0; i < employees.length; i++) {
      if (employees[i].group !== "파견직" && ["D", "S"].includes(data[i][d])) count++;
    }
    return count;
  }

  function rebalanceTargetOff(data, days, employees) {
    employees.forEach((employee, i) => {
      let off = countOff(data[i]);
      let need = getTargetOff(employee) - off;
      if (need > 0) {
        const candidates = [];
        for (let d = 0; d < days.length; d++) {
          if (data[i][d] !== "S" || isRedDay(days[d])) continue;
          if (countDayActive(data, d) <= state.config.minActive) continue;
          if (wouldBreakWeekendGeneral(data, employees, days[d], d, i)) continue;
          candidates.push({ d, score: countDayActive(data, d) * 20 + getStreakLength(data, employees[i], i, d) });
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const item of candidates) {
          if (need <= 0) break;
          data[i][item.d] = "R";
          need--;
        }
      } else if (need < 0) {
        const candidates = [];
        for (let d = 0; d < days.length && need < 0; d++) {
          if (data[i][d] !== "R" || isRedDay(days[d])) continue;
          if (wouldViolateConsecutive(data, employees[i], i, d, "S")) continue;
          if (isAfterWake(data, employees, i, d)) continue;
          const priority = 0;
          candidates.push({ d, priority });
        }
        candidates.sort((a, b) => a.priority - b.priority);
        for (const item of candidates) {
          if (need >= 0) break;
          data[i][item.d] = "S";
          need++;
        }
      }
    });
  }

  function rebalanceTargetOffBySwaps(data, days, employees) {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 60) {
      changed = false;
      const restCounts = data.map(row => countOff(row));
      const targets = employees.map(getTargetOff);
      const deficits = employees
        .map((employee, index) => ({ employee, index, diff: targets[index] - restCounts[index] }))
        .filter(item => item.diff > 0)
        .sort((a, b) => b.diff - a.diff);

      for (const victim of deficits) {
        const swap = findRestSwap(data, days, employees, victim.index, restCounts, targets);
        if (!swap) continue;
        const role = data[victim.index][swap.day];
        data[swap.donor][swap.day] = role;
        data[victim.index][swap.day] = "R";
        restCounts[victim.index]++;
        restCounts[swap.donor]--;
        changed = true;
        break;
      }
    }
  }

  function findRestSwap(data, days, employees, victimIndex, restCounts, targets) {
    const candidates = [];
    for (let d = 0; d < days.length; d++) {
      const role = data[victimIndex][d];
      if (!canTradeRoleForRest(role)) continue;
      if (state.manual[keyOf(employees[victimIndex].id, toIsoDate(days[d]))]) continue;
      if (role === "S" && !isRedDay(days[d]) && countDayActive(data, d) <= state.config.minActive) continue;
      if (role === "S" && wouldBreakWeekendGeneral(data, employees, days[d], d, victimIndex)) continue;
      const score = getRestSwapDayScore(data, employees, victimIndex, d, role);
      candidates.push({ d, role, score });
    }
    candidates.sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      const donors = employees
        .map((employee, index) => ({ employee, index, surplus: restCounts[index] - targets[index] }))
        .filter(item => item.index !== victimIndex && item.surplus > 0)
        .filter(item => data[item.index][candidate.d] === "R")
        .filter(item => canDonorTakeRole(data, days, employees, item.index, candidate.d, candidate.role))
        .sort((a, b) => {
          if (b.surplus !== a.surplus) return b.surplus - a.surplus;
          return countCritical(data, a.index, candidate.d) - countCritical(data, b.index, candidate.d);
        });
      if (donors.length) return { day: candidate.d, donor: donors[0].index };
    }
    return null;
  }

  function canTradeRoleForRest(role) {
    return ["S", "E", "M1", "M2", "M3"].includes(role);
  }

  function getRestSwapDayScore(data, employees, idx, d, role) {
    let score = 0;
    if (role === "S") score += 80;
    if (role === "E") score += 60;
    if (isMRole(role)) score += 45;
    if (isAfterWake(data, employees, idx, d)) score -= 80;
    score += getStreakLength(data, employees[idx], idx, d) * 15;
    return score;
  }

  function canDonorTakeRole(data, days, employees, donorIndex, d, role) {
    const donor = employees[donorIndex];
    const dateKey = toIsoDate(days[d]);
    if (state.manual[keyOf(donor.id, dateKey)]) return false;
    if (data[donorIndex][d] === "R" && isAfterWake(data, employees, donorIndex, d)) return false;
    if (wouldViolateConsecutive(data, donor, donorIndex, d, role)) return false;
    if (role === "S") {
      if (isAfterWake(data, employees, donorIndex, d)) return false;
      return true;
    }
    if (role === "E") {
      if (donor.group === "파견직") return false;
      if (donor.mPool) return false;
      return true;
    }
    if (isMRole(role)) {
      const pools = getPools();
      if ((pools.m.length || pools.mStandby.length) && !donor.mPool && !donor.mStandby) return false;
      if (!(pools.m.length || pools.mStandby.length) && donor.group === "파견직") return false;
      return true;
    }
    return false;
  }

  function relieveMCoreWithStandby(data, days, employees) {
    const pools = getPools();
    if (!pools.m.length || !pools.mStandby.length) return;

    let changed = true;
    let guard = 0;
    const maxPasses = Math.max(30, pools.m.length * days.length);

    while (changed && guard++ < maxPasses) {
      changed = false;
      const restCounts = data.map(row => countOff(row));
      const targets = employees.map(getTargetOff);
      const victims = pools.m
        .map(index => ({ index, deficit: targets[index] - restCounts[index] }))
        .filter(item => item.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);

      for (const victim of victims) {
        const transfer = findMStandbyTransfer(data, days, employees, victim.index, restCounts, targets);
        if (!transfer) continue;
        data[transfer.standbyIndex][transfer.day] = transfer.role;
        data[victim.index][transfer.day] = "R";
        changed = true;
        break;
      }
    }
  }

  function findMStandbyTransfer(data, days, employees, victimIndex, restCounts, targets) {
    const pools = getPools();
    const candidates = [];

    for (let d = 0; d < days.length; d++) {
      const role = data[victimIndex][d];
      const dateKey = toIsoDate(days[d]);
      if (!isMRole(role)) continue;
      if (state.manual[keyOf(employees[victimIndex].id, dateKey)]) continue;

      const standbyCandidates = pools.mStandby
        .filter(index => index !== victimIndex)
        .filter(index => ["R", "S", "E"].includes(data[index][d]))
        .filter(index => !state.manual[keyOf(employees[index].id, dateKey)])
        .filter(index => isManualRoleAllowed(employees[index].id, dateKey, role))
        .filter(index => !wouldViolateConsecutive(data, employees[index], index, d, role))
        .filter(index => canUseStandbyForMTransfer(data, days, employees, index, d, restCounts, targets))
        .map(index => ({
          index,
          score: getMStandbyTransferScore(data, days, employees, index, d, role, restCounts, targets)
        }))
        .sort((a, b) => b.score - a.score);

      if (standbyCandidates.length) {
        candidates.push({
          day: d,
          role,
          standbyIndex: standbyCandidates[0].index,
          score: standbyCandidates[0].score + getStreakLength(data, employees[victimIndex], victimIndex, d) * 20
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.length ? candidates[0] : null;
  }

  function canUseStandbyForMTransfer(data, days, employees, standbyIndex, d, restCounts, targets) {
    const role = data[standbyIndex][d];
    if (isAfterWake(data, employees, standbyIndex, d)) return false;
    if (role === "R") return restCounts[standbyIndex] > targets[standbyIndex];
    if (role === "S" || role === "E") {
      if (isRedDay(days[d])) return true;
      const activeMargin = countDayActive(data, d) - state.config.minActive;
      const esMargin = countDayEs(data, d) - state.config.minEs;
      return activeMargin > 0 && esMargin > 0;
    }
    return false;
  }

  function getMStandbyTransferScore(data, days, employees, standbyIndex, d, role, restCounts, targets) {
    const currentRole = data[standbyIndex][d];
    let score = 0;
    if (currentRole === "R") score += 180 + Math.max(0, restCounts[standbyIndex] - targets[standbyIndex]) * 60;
    if (currentRole === "S") score += 120;
    if (currentRole === "E") score += 90;
    if (isAfterWake(data, employees, standbyIndex, d)) score -= 100;
    score -= countEmployeeRole(data, standbyIndex, role, d) * 25;
    score -= countCritical(data, standbyIndex, d) * 4;
    score += seededNoise(`${getScheduleSeed()}|M_STANDBY|${employees[standbyIndex].id}|${toIsoDate(days[d])}|${role}`) * 10;
    return score;
  }

  function forceExactTargetOff(data, days, employees) {
    const targets = employees.map(getTargetOff);
    let guard = 0;
    const maxPasses = Math.max(120, employees.length * days.length * 4);

    while (guard++ < maxPasses) {
      const restCounts = data.map(row => countOff(row));
      const deficits = employees
        .map((employee, index) => ({ employee, index, diff: targets[index] - restCounts[index] }))
        .filter(item => item.diff > 0)
        .sort((a, b) => b.diff - a.diff);
      const surpluses = employees
        .map((employee, index) => ({ employee, index, diff: restCounts[index] - targets[index] }))
        .filter(item => item.diff > 0)
        .sort((a, b) => b.diff - a.diff);

      if (!deficits.length && !surpluses.length) break;

      let changed = false;

      for (const victim of deficits) {
        const swap = findRestSwap(data, days, employees, victim.index, restCounts, targets);
        if (swap) {
          const role = data[victim.index][swap.day];
          data[swap.donor][swap.day] = role;
          data[victim.index][swap.day] = "R";
          changed = true;
          break;
        }

        const restDay = findForcedRestDay(data, days, employees, victim.index);
        if (restDay === null) continue;

        const donor = findForcedWorkDonor(data, days, employees, restCounts, targets, victim.index);
        data[victim.index][restDay] = "R";
        if (donor) data[donor.index][donor.day] = "S";
        changed = true;
        break;
      }

      if (changed) continue;

      for (const donor of surpluses) {
        const workDay = findForcedWorkDay(data, days, employees, donor.index, { allowConsecutiveRisk: guard > 24 });
        if (workDay === null) continue;
        data[donor.index][workDay] = "S";
        changed = true;
        break;
      }

      if (!changed) break;
    }
  }

  function findForcedRestDay(data, days, employees, employeeIndex) {
    const candidates = [];
    for (let d = 0; d < days.length; d++) {
      const role = data[employeeIndex][d];
      const dateKey = toIsoDate(days[d]);
      if (state.manual[keyOf(employees[employeeIndex].id, dateKey)]) continue;
      if (!canForceRoleToRest(role)) continue;

      let score = 0;
      if (role === "S") score += 120;
      else if (role === "E") score += 95;
      else if (isMRole(role)) score += 75;
      else score += 15;

      if (isAfterWake(data, employees, employeeIndex, d)) score += 80;
      score += getStreakLength(data, employees[employeeIndex], employeeIndex, d) * 10;
      if (!isRedDay(days[d]) && countDayActive(data, d) <= state.config.minActive) score -= 180;
      if (wouldBreakWeekendGeneral(data, employees, days[d], d, employeeIndex)) score -= 220;
      if (["D", "H", "P"].includes(role)) score -= 260;

      candidates.push({ d, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.length ? candidates[0].d : null;
  }

  function findForcedWorkDonor(data, days, employees, restCounts, targets, victimIndex) {
    const donors = employees
      .map((employee, index) => ({ employee, index, surplus: restCounts[index] - targets[index] }))
      .filter(item => item.index !== victimIndex && item.surplus > 0)
      .sort((a, b) => b.surplus - a.surplus);

    for (const options of [
      { allowConsecutiveRisk: false },
      { allowConsecutiveRisk: true }
    ]) {
      const candidates = [];
      for (const donor of donors) {
        const day = findForcedWorkDay(data, days, employees, donor.index, options);
        if (day === null) continue;
        candidates.push({
          index: donor.index,
          day,
          score: donor.surplus * 100 - (isAfterWake(data, employees, donor.index, day) ? 50 : 0)
        });
      }
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length) return candidates[0];
    }
    return null;
  }

  function findForcedWorkDay(data, days, employees, employeeIndex, options = {}) {
    const candidates = [];
    for (let d = 0; d < days.length; d++) {
      const dateKey = toIsoDate(days[d]);
      if (data[employeeIndex][d] !== "R") continue;
      if (state.manual[keyOf(employees[employeeIndex].id, dateKey)]) continue;
      if (isAfterWake(data, employees, employeeIndex, d)) continue;
      if (!options.allowConsecutiveRisk && wouldViolateConsecutive(data, employees[employeeIndex], employeeIndex, d, "S")) continue;

      let score = 100;
      if (isRedDay(days[d])) score += 20;
      if (isAfterWake(data, employees, employeeIndex, d)) score -= 80;
      if (wouldViolateConsecutive(data, employees[employeeIndex], employeeIndex, d, "S")) score -= 120;
      candidates.push({ d, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.length ? candidates[0].d : null;
  }

  function canForceRoleToRest(role) {
    return ["S", "E"].includes(role);
  }

  function repairMissingMRoles(data, days, employees) {
    for (let d = 0; d < days.length; d++) {
      const day = days[d];
      repairOneMRole(d, "M1");
      if (!isRedDay(day)) repairOneMRole(d, "M2");
      if (day.getDay() >= 1 && day.getDay() <= 4) repairOneMRole(d, "M3");
    }

    function repairOneMRole(d, role) {
      if (hasRoleOnDay(data, d, role)) return;
      const candidate = findMRepairCandidate(data, days, employees, d, role);
      if (candidate === null) return;
      data[candidate][d] = role;
    }
  }

  function findMRepairCandidate(data, days, employees, d, role) {
    const pools = getPools();
    const primary = pools.m.length ? pools.m : (pools.mStandby.length ? [] : pools.standard);
    const searchPools = pools.mStandby.length ? [primary, pools.mStandby] : [primary];
    const dateKey = toIsoDate(days[d]);

    for (const pool of searchPools) {
      const candidates = pool
        .filter(index => index !== null && index !== undefined)
        .filter(index => ["S", "R", "E"].includes(data[index][d]))
        .filter(index => data[index][d] !== "R" || !isAfterWake(data, employees, index, d))
        .filter(index => !state.manual[keyOf(employees[index].id, dateKey)])
        .filter(index => isManualRoleAllowed(employees[index].id, dateKey, role))
        .filter(index => !wouldViolateConsecutive(data, employees[index], index, d, role))
        .map(index => ({
          index,
          score: getMRepairScore(data, employees, index, d, role)
        }))
        .sort((a, b) => b.score - a.score);
      if (candidates.length) return candidates[0].index;
    }

    return null;
  }

  function getMRepairScore(data, employees, index, d, role) {
    const currentRole = data[index][d];
    let score = 0;
    if (currentRole === "S") score += 120;
    if (currentRole === "E") score += 80;
    if (currentRole === "R") score += 20;
    if (employees[index].mPool) score += 50;
    if (employees[index].mStandby) score -= 30;
    score -= countEmployeeRole(data, index, role, d) * 20;
    score -= countCritical(data, index, d) * 4;
    return score;
  }

  function enforceMaxConsecutive(data, days, employees) {
    for (let i = 0; i < employees.length; i++) {
      let changed = true;
      let guard = 0;
      while (changed && guard++ < 20) {
        changed = false;
        let streak = getPastConsecutive(employees[i]);
        const streakDays = [];
        for (let d = 0; d < days.length; d++) {
          if (isRestRole(data[i][d])) {
            streak = 0;
            streakDays.length = 0;
          } else {
            streak++;
            streakDays.push(d);
            if (streak > state.config.maxConsecutive) {
              const target = streakDays.find(day => data[i][day] === "S");
              if (target !== undefined && !wouldBreakWeekendGeneral(data, employees, days[target], target, i)) {
                data[i][target] = "R";
                changed = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  function validateAndRender(options = {}) {
    const { switchTab = true } = options;
    latestIssues = validateSchedule();
    renderSchedule();
    renderStats();
    renderIssues(latestIssues);
    if (switchTab) {
      setActiveTab(latestIssues.length ? "issuesTab" : "scheduleTab", latestIssues.length ? "issuesView" : "scheduleView");
    }
    showNotice(latestIssues.length ? `${latestIssues.length}개의 검증 항목이 있습니다.` : "검증을 통과했습니다.");
    return latestIssues;
  }

  function validateSchedule() {
    const days = getScheduleDays();
    const issues = [];

    days.forEach(day => {
      const d = dayIndex(day);
      const dateKey = toIsoDate(day);
      const counts = countRolesForDay(dateKey);
      if (!isRedDay(day)) {
        const active = (counts.E || 0) + (counts.S || 0) + (counts.D || 0) + (counts.P || 0);
        const es = (counts.E || 0) + (counts.S || 0);
        if (active < state.config.minActive) addDayIssue("가동 인원 부족", `${dateKey}: E+S+D+P ${active}명, 기준 ${state.config.minActive}명`, dateKey);
        if (es < state.config.minEs) addDayIssue("E+S 부족", `${dateKey}: E+S ${es}명, 기준 ${state.config.minEs}명`, dateKey);
      }
      if (isWeekend(day)) {
        const generalDs = state.employees.filter(emp => emp.group !== "파견직")
          .reduce((sum, emp) => sum + (["D", "S"].includes(getRole(emp.id, dateKey)) ? 1 : 0), 0);
        if (generalDs < state.config.fridayDs) addDayIssue("토/일 D+S 부족", `${dateKey}: 일반/전문직 D+S ${generalDs}명, 기준 ${state.config.fridayDs}명`, dateKey);
      }
      checkExpectedRole("N", 1);
      checkExpectedRole("D", 1);
      checkExpectedRole("H", day.getDay() === 0 ? 0 : 1);
      checkExpectedRole("M1", 1);
      checkExpectedRole("M2", isRedDay(day) ? 0 : 1);
      checkExpectedRole("M3", day.getDay() >= 1 && day.getDay() <= 4 ? 1 : 0);
      checkExpectedRole("P", isWeekend(day) ? 0 : 1);

      function checkExpectedRole(role, expected) {
        const actual = counts[role] || 0;
        if (actual < expected) addDayIssue(`${role} 누락`, `${dateKey}: ${role} ${actual}명, 기준 ${expected}명`, dateKey);
        if (actual > expected && ["H", "M1", "M2", "M3", "P", "N", "D"].includes(role)) addDayIssue(`${role} 초과`, `${dateKey}: ${role} ${actual}명, 기준 ${expected}명`, dateKey);
      }

      function addDayIssue(title, message, date) {
        issues.push({ title, message, date });
      }
    });

    const pools = getPools();
    state.employees.forEach((employee) => {
      let consecutive = 0;
      let lastN = -999;
      const restTotal = countEmployeeRest(employee.id, days);
      const restTarget = getTargetOff(employee);
      if (restTotal < restTarget) {
        issues.push({ title: "목표 휴무 미달", message: `${employee.name}: 휴무 X+R ${restTotal}일, 목표 ${restTarget}일입니다.`, empId: employee.id });
      } else if (restTotal > restTarget) {
        issues.push({ title: "목표 휴무 초과", message: `${employee.name}: 휴무 X+R ${restTotal}일, 목표 ${restTarget}일입니다.`, empId: employee.id });
      }
      employee.past.forEach((role, pastIdx) => {
        if (isRestRole(role) || !role) consecutive = 0;
        else consecutive++;
        if (role === "N") lastN = pastIdx - 4;
      });
      days.forEach((day, d) => {
        const dateKey = toIsoDate(day);
        const role = getRole(employee.id, dateKey);
        if ((role === "N" || role === "W") && pools.nw.length && !employee.nwPool) {
          issues.push({ title: "N/W풀 위반", message: `${employee.name} ${dateKey}: N/W풀에 체크되지 않은 인원입니다.`, empId: employee.id, date: dateKey });
        } else if ((role === "N" || role === "W") && !pools.nw.length && employee.group === "파견직") {
          issues.push({ title: "N/W풀 위반", message: `${employee.name} ${dateKey}: N/W풀이 비어 있을 때 파견직은 N/W 후보가 아닙니다.`, empId: employee.id, date: dateKey });
        }
        if (role === "H") {
          if (pools.h.length && !employee.hPool) {
            issues.push({ title: "H풀 위반", message: `${employee.name} ${dateKey}: H풀에 체크되지 않은 인원입니다.`, empId: employee.id, date: dateKey });
          }
          const prev = d === 0 ? employee.past[3] : getRole(employee.id, toIsoDate(days[d - 1]));
          if (!canPrecedeH(prev)) {
            issues.push({ title: "H 전날 보호 위반", message: `${employee.name} ${dateKey}: H 전날이 ${prev || "공란"}입니다.`, empId: employee.id, date: dateKey });
          }
        }
        if (isMRole(role)) {
          if ((pools.m.length || pools.mStandby.length) && !employee.mPool && !employee.mStandby) {
            issues.push({ title: "M풀 위반", message: `${employee.name} ${dateKey}: M풀/M대기에 체크되지 않은 인원입니다.`, empId: employee.id, date: dateKey });
          } else if (!(pools.m.length || pools.mStandby.length) && employee.group === "파견직") {
            issues.push({ title: "M풀 위반", message: `${employee.name} ${dateKey}: M풀이 비어 있을 때 파견직은 M 후보가 아닙니다.`, empId: employee.id, date: dateKey });
          }
        }
        if (role === "N") {
          if (d - lastN <= state.config.nGap) {
            issues.push({ title: "N 간격 위반", message: `${employee.name} ${dateKey}: 이전 N과 ${d - lastN}일 간격입니다.`, empId: employee.id, date: dateKey });
          }
          lastN = d;
        }
        if (isRestRole(role) || !role) consecutive = 0;
        else {
          consecutive++;
          if (consecutive > state.config.maxConsecutive) {
            issues.push({ title: "연속근무 위반", message: `${employee.name} ${dateKey}: ${consecutive}일 연속 근무입니다.`, empId: employee.id, date: dateKey });
          }
        }
      });
    });

    validateNightWakeAlternation(days, issues);
    validateWeekendNWPatterns(days, issues);

    return issues;
  }

  function writeDataToState(data, days, employees) {
    const keptManual = { ...state.manual };
    state.schedule = {};
    state.manual = {};
    employees.forEach((employee, i) => {
      state.schedule[employee.id] = {};
      days.forEach((day, d) => {
        const dateKey = toIsoDate(day);
        const role = data[i][d];
        if (role) state.schedule[employee.id][dateKey] = role;
        if (role && keptManual[keyOf(employee.id, dateKey)]) state.manual[keyOf(employee.id, dateKey)] = true;
      });
    });
  }

  function clearGeneratedScheduleKeepManualProtected() {
    const keptSchedule = {};
    const keptManual = {};
    const keepRoles = new Set(getProtectedRoles());

    state.employees.forEach(employee => {
      const employeeSchedule = state.schedule[employee.id] || {};
      Object.entries(employeeSchedule).forEach(([date, role]) => {
        const key = keyOf(employee.id, date);
        const keepManualRole = state.manual[key] && keepRoles.has(role);
        const keepProtectedH = role === "H" && isHProtectionEnabled();
        if (keepManualRole || keepProtectedH) {
          keptSchedule[employee.id] ||= {};
          keptSchedule[employee.id][date] = role;
          if (state.manual[key]) keptManual[key] = true;
        }
      });
    });

    state.schedule = keptSchedule;
    state.manual = keptManual;
  }

  function applyDrop(payload, targetEmployeeId, targetDate) {
    const result = canApplyDrop(payload, targetEmployeeId, targetDate);
    if (!result.ok) {
      showNotice(result.reason);
      return false;
    }

    if (payload.source === "cell" && (payload.employeeId !== targetEmployeeId || payload.date !== targetDate)) {
      pushHistory(payload.bundle?.kind === "NW" ? "N/W 세트 교환" : "근무 교환");
      const changedKeys = getBundleSwapKeys(payload, targetEmployeeId, targetDate);
      applyBundleSwap(payload, targetEmployeeId, targetDate);
      markLastChangedCells(changedKeys);
      latestIssues = validateSchedule();
      renderSchedule();
      renderStats();
      renderIssues(latestIssues);
      saveState();
      return true;
    }

    return setRole(targetEmployeeId, targetDate, payload.role, true, { enforce: true });
  }

  function canApplyDrop(payload, targetEmployeeId, targetDate) {
    if (!payload) return { ok: false, reason: "근무 모듈을 먼저 선택하세요." };
    const cacheKey = JSON.stringify({ mode: getEditMode(), payload, targetEmployeeId, targetDate });
    if (dropCheckCache.has(cacheKey)) return dropCheckCache.get(cacheKey);

    let result;

    if (payload.source === "cell" && payload.employeeId === targetEmployeeId && payload.date === targetDate) {
      result = { ok: false, reason: "같은 셀에는 다시 놓을 수 없습니다." };
    } else if (getEditMode() === "setup") {
      result = canApplyForceDrop(payload, targetEmployeeId, targetDate);
    } else if (payload.source === "cell") {
      if (targetDate !== payload.date) {
        result = { ok: false, reason: "같은 날짜 열에서만 교환할 수 있습니다." };
        dropCheckCache.set(cacheKey, result);
        return result;
      }
      result = canApplyScheduleMutation(() => {
        const bundleCheck = validateBundleSwap(payload, targetEmployeeId, targetDate);
        if (!bundleCheck.ok) return bundleCheck;
        applyBundleSwap(payload, targetEmployeeId, targetDate);
        return { ok: true };
      });
    } else {
      result = canApplyScheduleMutation(() => {
        const targets = getPaletteApplyTargets(targetEmployeeId, targetDate, payload.role);
        for (const target of targets) {
          if (!isManualRoleAllowed(targetEmployeeId, target.date, target.role)) {
            return { ok: false, reason: `${payload.role || "공란"}은 이 직원/날짜에 배치할 수 없습니다.` };
          }
        }
        targets.forEach(target => applyRoleRaw(targetEmployeeId, target.date, target.role));
        return { ok: true };
      });
    }

    dropCheckCache.set(cacheKey, result);
    return result;
  }

  function canApplyForceDrop(payload, targetEmployeeId, targetDate) {
    if (payload.source === "cell") {
      if (targetDate !== payload.date) {
        return { ok: false, reason: "같은 날짜 안에서만 교환할 수 있습니다." };
      }
      return validateBundleSwap(payload, targetEmployeeId, targetDate, { force: true });
    }

    const normalized = normalizePaletteRole(payload.role);
    if (normalized && !ROLE_DEFS[normalized]) return { ok: false, reason: "지원하지 않는 근무 코드입니다." };
    return { ok: true };
  }

  function createCellDragPayload(role, employeeId, date) {
    const normalized = String(role || "").trim().toUpperCase();
    const prevDate = toIsoDate(addDays(parseIsoDate(date), -1));
    const nextDate = toIsoDate(addDays(parseIsoDate(date), 1));

    if (normalized === "N" && getRole(employeeId, nextDate) === "W") {
      return {
        role: normalized,
        source: "cell",
        employeeId,
        date,
        bundle: {
          kind: "NW",
          anchorOffset: 0,
          sourceStartDate: date,
          items: [{ offset: 0, role: "N" }, { offset: 1, role: "W" }]
        }
      };
    }

    if (normalized === "W" && getRole(employeeId, prevDate) === "N") {
      return {
        role: normalized,
        source: "cell",
        employeeId,
        date,
        bundle: {
          kind: "NW",
          anchorOffset: 1,
          sourceStartDate: prevDate,
          items: [{ offset: 0, role: "N" }, { offset: 1, role: "W" }]
        }
      };
    }

    return {
      role: normalized,
      source: "cell",
      employeeId,
      date,
      bundle: {
        kind: "single",
        anchorOffset: 0,
        sourceStartDate: date,
        items: [{ offset: 0, role: normalized }]
      }
    };
  }

  function validateBundleSwap(payload, targetEmployeeId, targetDate, options = {}) {
    const bundle = payload.bundle || {
      kind: "single",
      anchorOffset: 0,
      sourceStartDate: payload.date,
      items: [{ offset: 0, role: payload.role }]
    };
    const targetStartDate = toIsoDate(addDays(parseIsoDate(targetDate), -bundle.anchorOffset));
    if (!parseIsoDate(targetStartDate)) return { ok: false, reason: "대상 날짜를 확인할 수 없습니다." };
    if (payload.employeeId === targetEmployeeId && bundle.sourceStartDate === targetStartDate) {
      return { ok: false, reason: "같은 셀에는 다시 놓을 수 없습니다." };
    }

    const sourceKeys = new Set();
    const targetKeys = new Set();
    for (const item of bundle.items) {
      const sourceDate = toIsoDate(addDays(parseIsoDate(bundle.sourceStartDate), item.offset));
      const targetMoveDate = toIsoDate(addDays(parseIsoDate(targetStartDate), item.offset));
      if (!isDateInSchedule(sourceDate) || !isDateInSchedule(targetMoveDate)) {
        return { ok: false, reason: bundle.kind === "NW" ? "N/W 세트가 기간 밖으로 벗어납니다." : "기간 밖 날짜입니다." };
      }
      const targetRole = getRole(targetEmployeeId, targetMoveDate);
      if (bundle.kind !== "NW" && isPairedNWCell(targetEmployeeId, targetMoveDate, targetRole)) {
        return { ok: false, reason: "N/W 세트는 묶음으로만 교환할 수 있습니다." };
      }
      if (!options.force && !isManualRoleAllowed(targetEmployeeId, targetMoveDate, item.role)) {
        return { ok: false, reason: `${item.role || "공란"}은 대상 직원에게 배치할 수 없습니다.` };
      }
      if (!options.force && !isManualRoleAllowed(payload.employeeId, sourceDate, targetRole)) {
        return { ok: false, reason: `${targetRole || "공란"}은 원래 직원에게 교환 배치할 수 없습니다.` };
      }
      sourceKeys.add(keyOf(payload.employeeId, sourceDate));
      targetKeys.add(keyOf(targetEmployeeId, targetMoveDate));
    }

    if (payload.employeeId === targetEmployeeId) {
      for (const key of sourceKeys) {
        if (targetKeys.has(key)) return { ok: false, reason: "겹치는 N/W 세트는 교환할 수 없습니다." };
      }
    }

    return { ok: true };
  }

  function applyBundleSwap(payload, targetEmployeeId, targetDate) {
    const bundle = payload.bundle || {
      kind: "single",
      anchorOffset: 0,
      sourceStartDate: payload.date,
      items: [{ offset: 0, role: payload.role }]
    };
    const targetStartDate = toIsoDate(addDays(parseIsoDate(targetDate), -bundle.anchorOffset));
    const targetRoles = bundle.items.map(item => {
      const targetMoveDate = toIsoDate(addDays(parseIsoDate(targetStartDate), item.offset));
      return getRole(targetEmployeeId, targetMoveDate);
    });

    bundle.items.forEach((item, index) => {
      const sourceDate = toIsoDate(addDays(parseIsoDate(bundle.sourceStartDate), item.offset));
      const targetMoveDate = toIsoDate(addDays(parseIsoDate(targetStartDate), item.offset));
      applyRoleRaw(targetEmployeeId, targetMoveDate, item.role);
      applyRoleRaw(payload.employeeId, sourceDate, targetRoles[index]);
      state.manual[keyOf(targetEmployeeId, targetMoveDate)] = true;
      state.manual[keyOf(payload.employeeId, sourceDate)] = true;
    });
  }

  function getBundleSwapKeys(payload, targetEmployeeId, targetDate) {
    const bundle = payload.bundle || {
      kind: "single",
      anchorOffset: 0,
      sourceStartDate: payload.date,
      items: [{ offset: 0, role: payload.role }]
    };
    const targetStartDate = toIsoDate(addDays(parseIsoDate(targetDate), -bundle.anchorOffset));
    const keys = [];
    bundle.items.forEach(item => {
      const sourceDate = toIsoDate(addDays(parseIsoDate(bundle.sourceStartDate), item.offset));
      const targetMoveDate = toIsoDate(addDays(parseIsoDate(targetStartDate), item.offset));
      keys.push(
        ...getNightWakeHighlightKeys(payload.employeeId, sourceDate, item.role),
        ...getNightWakeHighlightKeys(targetEmployeeId, targetMoveDate, item.role)
      );
    });
    return [...new Set(keys)];
  }

  function getNightWakeHighlightKeys(employeeId, date, role) {
    const normalized = String(role || "").trim().toUpperCase();
    const keys = [keyOf(employeeId, date)];
    const parsedDate = parseIsoDate(date);
    if (!parsedDate) return keys;

    if (normalized === "N") {
      const nextDate = toIsoDate(addDays(parsedDate, 1));
      if (isDateInSchedule(nextDate)) keys.push(keyOf(employeeId, nextDate));
    } else if (normalized === "W") {
      const prevDate = toIsoDate(addDays(parsedDate, -1));
      if (isDateInSchedule(prevDate)) keys.push(keyOf(employeeId, prevDate));
    }
    return keys;
  }

  function canApplyScheduleMutation(mutator) {
    const beforeSchedule = JSON.stringify(state.schedule);
    const beforeManual = JSON.stringify(state.manual);
    const beforeIssues = new Set(validateSchedule().map(issueSignature));
    const precheck = mutator();
    if (precheck && precheck.ok === false) {
      state.schedule = JSON.parse(beforeSchedule);
      state.manual = JSON.parse(beforeManual);
      return precheck;
    }
    if (getEditMode() === "setup") {
      state.schedule = JSON.parse(beforeSchedule);
      state.manual = JSON.parse(beforeManual);
      return { ok: true };
    }
    const afterIssues = validateSchedule();
    state.schedule = JSON.parse(beforeSchedule);
    state.manual = JSON.parse(beforeManual);

    const newIssues = afterIssues.filter(issue => !beforeIssues.has(issueSignature(issue)));
    if (newIssues.length) {
      return {
        ok: false,
        reason: `배치 불가: ${newIssues[0].title}`
      };
    }
    return { ok: true };
  }

  function isManualRoleAllowed(employeeId, date, role) {
    const normalized = String(role || "").trim().toUpperCase();
    if (!normalized) return true;
    const employeeIndex = state.employees.findIndex(employee => employee.id === employeeId);
    const employee = state.employees[employeeIndex];
    if (!employee || !ROLE_DEFS[normalized]) return false;

    const pools = getPools();
    const d = dayIndex(parseIsoDate(date));
    const day = parseIsoDate(date);
    if (!day || d < 0) return false;

    if ((normalized === "N" || normalized === "W") && pools.nw.length && !employee.nwPool) return false;
    if ((normalized === "N" || normalized === "W") && !pools.nw.length && employee.group === "파견직") return false;
    if (normalized === "H" && pools.h.length && !employee.hPool) return false;
    if (normalized === "D" && pools.d.length && !employee.dPool) return false;
    if (normalized === "P" && pools.p.length && !employee.pPool) return false;
    if (isMRole(normalized) && (pools.m.length || pools.mStandby.length) && !employee.mPool && !employee.mStandby) return false;
    if (["M1", "M2", "M3"].includes(normalized) && employee.group === "파견직") return false;
    if (normalized === "H" && day.getDay() === 0) return false;
    if (normalized === "P" && isWeekend(day)) return false;
    if (normalized === "M2" && isRedDay(day)) return false;
    if (normalized === "M3" && !(day.getDay() >= 1 && day.getDay() <= 4)) return false;
    return true;
  }

  function getEditMode() {
    return state.ui?.editMode === "validate" ? "validate" : "setup";
  }

  function isPairedNWCell(employeeId, date, role = getRole(employeeId, date)) {
    if (role === "N") {
      const nextDate = toIsoDate(addDays(parseIsoDate(date), 1));
      return getRole(employeeId, nextDate) === "W";
    }
    if (role === "W") {
      const prevDate = toIsoDate(addDays(parseIsoDate(date), -1));
      return getRole(employeeId, prevDate) === "N";
    }
    return false;
  }

  function getRoleEditTargets(employeeId, date) {
    const role = getRole(employeeId, date);
    const parsedDate = parseIsoDate(date);
    if (!parsedDate) return [date];
    if (role === "N") {
      const nextDate = toIsoDate(addDays(parsedDate, 1));
      if (isDateInSchedule(nextDate) && getRole(employeeId, nextDate) === "W") return [date, nextDate];
    }
    if (role === "W") {
      const prevDate = toIsoDate(addDays(parsedDate, -1));
      if (isDateInSchedule(prevDate) && getRole(employeeId, prevDate) === "N") return [prevDate, date];
    }
    return [date];
  }

  function applyRoleGroupRaw(employeeId, date, role) {
    const normalized = normalizePaletteRole(role);
    getRoleEditTargets(employeeId, date, role).forEach(targetDate => applyRoleRaw(employeeId, targetDate, normalized));
  }

  function getPaletteApplyTargets(employeeId, date, role) {
    const normalized = String(role || "").trim().toUpperCase();
    const parsedDate = parseIsoDate(date);
    if ((normalized === "NW" || normalized === "N") && parsedDate) {
      const nextDate = toIsoDate(addDays(parsedDate, 1));
      if (isDateInSchedule(nextDate)) return [
        { date, role: "N" },
        { date: nextDate, role: "W" }
      ];
    }
    return getRoleEditTargets(employeeId, date).map(targetDate => ({
      date: targetDate,
      role: normalizePaletteRole(role)
    }));
  }

  function normalizePaletteRole(role) {
    const normalized = String(role || "").trim().toUpperCase();
    return normalized === "NW" ? "N" : normalized;
  }

  function readDragPayload(event) {
    if (dragPayload) return dragPayload;
    try {
      const raw = event.dataTransfer?.getData("application/json");
      if (raw) return JSON.parse(raw);
    } catch {
      return null;
    }
    const role = event.dataTransfer?.getData("text/plain");
    return role !== undefined ? { role, source: "palette" } : null;
  }

  function highlightDragTargets(payload) {
    clearDragHighlights();
    if (!payload) return;
    el.scheduleTable.classList.add("drag-preview");
    const cells = Array.from(el.scheduleTable.querySelectorAll(".schedule-cell"));
    cells.forEach(cell => cell.classList.add("drop-dimmed"));

    const candidateCells = payload.source === "cell"
      ? cells.filter(cell => cell.dataset.date === payload.date)
      : cells;

    candidateCells.forEach(cell => {
      const result = payload.source === "cell"
        ? canApplyDrop(payload, cell.dataset.employeeId, cell.dataset.date)
        : quickCanPreviewDrop(payload, cell.dataset.employeeId, cell.dataset.date);
      if (result.ok) {
        getDropPreviewCells(payload, cell.dataset.employeeId, cell.dataset.date).forEach((targetCell, index) => {
          targetCell.classList.remove("drop-dimmed");
          targetCell.classList.add("drop-candidate");
          markEmployeeHead(targetCell.dataset.employeeId, "drop-candidate-row");
          targetCell.title = payload.bundle?.kind === "NW" ? (index === 0 ? "N/W 세트 교환 가능" : "함께 이동되는 N/W 셀") : "교환 가능";
        });
      } else {
        cell.classList.add("drop-dimmed");
        cell.title = result.reason;
      }
    });
    markDragSource(payload);
  }

  function quickCanPreviewDrop(payload, targetEmployeeId, targetDate) {
    if (!payload) return { ok: false, reason: "근무 모듈을 먼저 선택하세요." };
    if (payload.source === "cell") {
      if (payload.employeeId === targetEmployeeId && payload.date === targetDate) {
        return { ok: false, reason: "같은 셀에는 다시 놓을 수 없습니다." };
      }
      if (targetDate !== payload.date) {
        return { ok: false, reason: "같은 날짜 열에서만 교환할 수 있습니다." };
      }
      return { ok: true };
    }
    const normalized = normalizePaletteRole(payload.role);
    if (normalized && !ROLE_DEFS[normalized]) return { ok: false, reason: "지원하지 않는 근무 코드입니다." };
    return { ok: true };
  }

  function clearDragHighlights() {
    el.scheduleTable.classList.remove("drag-preview");
    el.scheduleTable.querySelectorAll(".schedule-cell").forEach(cell => {
      cell.classList.remove("drop-candidate", "drop-dimmed", "drag-over", "drop-active", "drop-linked", "drag-source");
      cell.removeAttribute("title");
    });
    el.scheduleTable.querySelectorAll(".employee-head").forEach(head => {
      head.classList.remove("drop-candidate-row", "drop-active-row", "drop-linked-row", "drop-hover-row", "drag-source-row");
    });
    activeDropPreviewCells = [];
    activeDropPreviewHeads = [];
  }

  function showActiveDropPreview(payload, targetEmployeeId, targetDate) {
    clearActiveDropPreview();
    activeDropPreviewCells = getDropPreviewCells(payload, targetEmployeeId, targetDate);
    activeDropPreviewCells.forEach((cell, index) => {
      cell.classList.add(index === 0 ? "drop-active" : "drop-linked");
    });
    const head = markEmployeeHead(targetEmployeeId, "drop-hover-row");
    if (head) activeDropPreviewHeads.push(head);
  }

  function clearActiveDropPreview() {
    activeDropPreviewCells.forEach(cell => {
      cell.classList.remove("drop-active", "drop-linked");
    });
    activeDropPreviewHeads.forEach(head => {
      head.classList.remove("drop-active-row", "drop-linked-row", "drop-hover-row");
    });
    activeDropPreviewCells = [];
    activeDropPreviewHeads = [];
  }

  function markEmployeeHead(employeeId, className) {
    const head = employeeHeadMap.get(employeeId);
    if (!head) return null;
    head.classList.add(className);
    return head;
  }

  function markDragSource(payload) {
    if (payload?.source !== "cell") return;
    getSourcePreviewCells(payload).forEach(cell => {
      cell.classList.remove("drop-dimmed", "drop-candidate");
      cell.classList.add("drag-source");
      cell.title = payload.bundle?.kind === "NW" ? "현재 들고 있는 원본 N/W 세트" : "현재 들고 있는 원본 셀";
    });
    markEmployeeHead(payload.employeeId, "drag-source-row");
  }

  function getSourcePreviewCells(payload) {
    const bundle = payload?.bundle || {
      kind: "single",
      anchorOffset: 0,
      sourceStartDate: payload?.date,
      items: [{ offset: 0, role: payload?.role || "" }]
    };
    if (!payload?.employeeId || !bundle.sourceStartDate) return [];
    const sourceStart = parseIsoDate(bundle.sourceStartDate);
    if (!sourceStart) return [];
    return bundle.items
      .map(item => findScheduleCell(payload.employeeId, toIsoDate(addDays(sourceStart, item.offset))))
      .filter(Boolean);
  }

  function getDropPreviewCells(payload, targetEmployeeId, targetDate) {
    if (payload?.source !== "cell") {
      return getPaletteApplyTargets(targetEmployeeId, targetDate, payload?.role)
        .map(target => findScheduleCell(targetEmployeeId, target.date))
        .filter(Boolean);
    }

    const bundle = payload?.bundle || {
      kind: "single",
      anchorOffset: 0,
      sourceStartDate: payload?.date || targetDate,
      items: [{ offset: 0, role: payload?.role || "" }]
    };
    const targetStartDate = toIsoDate(addDays(parseIsoDate(targetDate), -bundle.anchorOffset));
    const cells = [];

    bundle.items.forEach((item, index) => {
      const date = toIsoDate(addDays(parseIsoDate(targetStartDate), item.offset));
      const cell = findScheduleCell(targetEmployeeId, date);
      if (cell) {
        if (index === bundle.anchorOffset) cells.unshift(cell);
        else cells.push(cell);
      }
    });
    return [...new Set(cells)];
  }

  function findScheduleCell(employeeId, date) {
    return scheduleCellMap.get(keyOf(employeeId, date)) || null;
  }

  function startPainting() {
    hideContextMenu();
    isPainting = true;
    paintHistoryCaptured = false;
    document.body.classList.add("paint-active");
  }

  function stopPainting() {
    if (!isPainting) return;
    isPainting = false;
    paintHistoryCaptured = false;
    document.body.classList.remove("paint-active");
  }

  function paintCell(employeeId, date) {
    if (selectedRole === null) return;
    if (!paintHistoryCaptured) {
      pushHistory(selectedRole === "" ? "드래그 비우기" : `${selectedRole} 드래그 배치`);
      paintHistoryCaptured = true;
    }
    setRole(employeeId, date, selectedRole, true, { enforce: true, skipHistory: true });
  }

  function showCellContextMenu(employeeId, date, x, y) {
    hideContextMenu();
    contextMenu = document.createElement("div");
    contextMenu.className = "cell-context-menu";
    const currentRole = getRole(employeeId, date) || "공란";
    const title = document.createElement("div");
    title.className = "context-title";
    title.textContent = `${date} · 현재 ${currentRole}`;
    contextMenu.appendChild(title);

    [
      ["", "비우기"],
      ["NW", "NW 지정"],
      ["S", "S 지정"],
      ["E", "E 지정"],
      ["M1", "M1 지정"],
      ["M2", "M2 지정"],
      ["M3", "M3 지정"],
      ["P", "P 지정"],
      ["X", "X 지정"],
      ["D", "D 지정"],
      ["H", "H 지정"],
      ["R", "R 지정"]
    ].forEach(([role, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        setRole(employeeId, date, role, true, { enforce: true });
        hideContextMenu();
      });
      contextMenu.appendChild(button);
    });

    document.body.appendChild(contextMenu);
    const width = contextMenu.offsetWidth || 180;
    const height = contextMenu.offsetHeight || 230;
    contextMenu.style.left = `${Math.min(x, window.innerWidth - width - 10)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - height - 10)}px`;
  }

  function hideContextMenu() {
    if (!contextMenu) return;
    contextMenu.remove();
    contextMenu = null;
  }

  function showDragTooltip(message, event) {
    if (!message) return;
    if (!dragTooltip) {
      dragTooltip = document.createElement("div");
      dragTooltip.className = "drag-tooltip";
      document.body.appendChild(dragTooltip);
    }
    dragTooltip.textContent = message;
    dragTooltip.hidden = false;
    moveDragTooltip(event);
  }

  function moveDragTooltip(event) {
    if (!dragTooltip || dragTooltip.hidden) return;
    const offset = 14;
    const width = dragTooltip.offsetWidth || 220;
    const left = Math.min(event.clientX + offset, window.innerWidth - width - 10);
    const top = Math.min(event.clientY + offset, window.innerHeight - 56);
    dragTooltip.style.left = `${Math.max(10, left)}px`;
    dragTooltip.style.top = `${Math.max(10, top)}px`;
  }

  function hideDragTooltip() {
    if (dragTooltip) dragTooltip.hidden = true;
  }

  function showIssueTooltip(message, event) {
    if (!message) return;
    if (!issueTooltip) {
      issueTooltip = document.createElement("div");
      issueTooltip.className = "issue-tooltip";
      document.body.appendChild(issueTooltip);
    }
    issueTooltip.textContent = message;
    issueTooltip.hidden = false;
    moveIssueTooltip(event);
  }

  function moveIssueTooltip(event) {
    if (!issueTooltip || issueTooltip.hidden) return;
    const offset = 12;
    const width = issueTooltip.offsetWidth || 280;
    const height = issueTooltip.offsetHeight || 90;
    const left = Math.min(event.clientX + offset, window.innerWidth - width - 10);
    const top = Math.min(event.clientY + offset, window.innerHeight - height - 10);
    issueTooltip.style.left = `${Math.max(10, left)}px`;
    issueTooltip.style.top = `${Math.max(10, top)}px`;
  }

  function hideIssueTooltip() {
    if (issueTooltip) issueTooltip.hidden = true;
  }

  function setRole(employeeId, date, role, manual, options = {}) {
    if (!state.schedule[employeeId]) state.schedule[employeeId] = {};
    const normalized = normalizePaletteRole(role);
    if (normalized && !ROLE_DEFS[normalized]) return;
    const targets = getPaletteApplyTargets(employeeId, date, role);
    if (targets.length === 1 && normalized === getRole(employeeId, date)) return true;
    if (options.enforce) {
      const result = canApplyDrop({ role, source: "palette" }, employeeId, date);
      if (!result.ok) {
        showNotice(result.reason);
        return false;
      }
    }
    if (!options.skipHistory) pushHistory("근무 변경");
    const changedKeys = [];
    targets.forEach(target => {
      const previousRole = getRole(employeeId, target.date);
      applyRoleRaw(employeeId, target.date, target.role);
      const key = keyOf(employeeId, target.date);
      if (manual) state.manual[key] = true;
      if (!target.role) delete state.manual[key];
      changedKeys.push(
        ...getNightWakeHighlightKeys(employeeId, target.date, previousRole),
        ...getNightWakeHighlightKeys(employeeId, target.date, target.role)
      );
    });
    markLastChangedCells(changedKeys);
    latestIssues = validateSchedule();
    renderSchedule();
    renderStats();
    renderIssues(latestIssues);
    saveState();
    return true;
  }

  function addHoliday() {
    const value = el.holidayInput.value;
    if (!value || state.config.holidays.includes(value)) return;
    pushHistory("공휴일 추가");
    state.config.holidays.push(value);
    el.holidayInput.value = "";
    renderAll();
    saveState();
  }

  function exportCsv() {
    const days = getScheduleDays();
    const rows = [
      ["# 월간 근무표 자동화 앱 CSV 백업", "v2"],
      [],
      ["[CONFIG]"],
      ["key", "value"],
      ["startDate", state.config.startDate],
      ["endDate", state.config.endDate],
      ["targetOffDays", state.config.targetOffDays],
      ["maxConsecutive", state.config.maxConsecutive],
      ["shuffleSeed", state.config.shuffleSeed || ""],
      ["hProtection", isHProtectionEnabled()],
      ["nGap", state.config.nGap],
      ["minActive", state.config.minActive],
      ["minEs", state.config.minEs],
      ["fridayDs", state.config.fridayDs],
      ["panelCollapsed", Boolean(state.ui?.panelCollapsed)],
      ["editMode", getEditMode()],
      [],
      ["[HOLIDAYS]"],
      ["date"],
      ...state.config.holidays.sort().map(date => [date]),
      [],
      ["[EMPLOYEES]"],
      ["id", "name", "group", "plusOne", "nwPool", "hPool", "dPool", "pPool", "mPool", "mStandby", "D-4", "D-3", "D-2", "D-1"],
      ...state.employees.map(employee => [
        employee.id,
        employee.name,
        employee.group,
        Boolean(employee.plusOne),
        Boolean(employee.nwPool),
        Boolean(employee.hPool),
        Boolean(employee.dPool),
        Boolean(employee.pPool),
        Boolean(employee.mPool),
        Boolean(employee.mStandby),
        ...employee.past
      ]),
      [],
      ["[SCHEDULE]"],
      ["employeeId", "name", ...days.map(day => toIsoDate(day))]
    ];

    state.employees.forEach(employee => {
      const values = days.map(day => getRole(employee.id, toIsoDate(day)));
      rows.push([employee.id, employee.name, ...values]);
    });

    rows.push([], ["[MANUAL]"], ["employeeId", "date"]);
    Object.keys(state.manual).sort().forEach(key => {
      if (!state.manual[key]) return;
      const [employeeId, date] = key.split("|");
      rows.push([employeeId, date]);
    });

    const csv = "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `근무표_${state.config.startDate}_${state.config.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importCsvFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result || ""));
        const importedState = rows.some(row => row[0] === "[CONFIG]")
          ? stateFromBackupCsv(rows)
          : stateFromLegacyScheduleCsv(rows);
        pushHistory("CSV 가져오기");
        state = importedState;
        latestIssues = validateSchedule();
        refreshEmployeeSeed();
        syncInputs();
        renderAll();
        saveState();
        showNotice("CSV 파일을 가져왔습니다.");
      } catch (error) {
        showNotice(`CSV 가져오기 실패: ${error.message}`);
      }
    };
    reader.onerror = () => showNotice("CSV 파일을 읽지 못했습니다.");
    reader.readAsText(file, "utf-8");
  }

  function stateFromBackupCsv(rows) {
    const configRows = getCsvSection(rows, "[CONFIG]");
    const holidayRows = getCsvSection(rows, "[HOLIDAYS]");
    const employeeRows = getCsvSection(rows, "[EMPLOYEES]");
    const scheduleRows = getCsvSection(rows, "[SCHEDULE]");
    const manualRows = getCsvSection(rows, "[MANUAL]");

    const configMap = new Map(configRows.slice(1).filter(row => row[0]).map(row => [row[0], row[1]]));
    const employeeHeader = employeeRows[0] || [];
    const employeeData = employeeRows.slice(1).filter(row => row.some(Boolean));
    if (!employeeData.length) throw new Error("직원 데이터가 없습니다.");

    const employees = employeeData.map((row, index) => {
      const id = cellByHeader(row, employeeHeader, "id") || `emp-${index + 100}`;
      return {
        id,
        name: cellByHeader(row, employeeHeader, "name") || `직원 ${index + 1}`,
        group: GROUPS.includes(cellByHeader(row, employeeHeader, "group")) ? cellByHeader(row, employeeHeader, "group") : "일반직",
        plusOne: parseBool(cellByHeader(row, employeeHeader, "plusOne")),
        nwPool: parseBool(cellByHeader(row, employeeHeader, "nwPool")),
        hPool: parseBool(cellByHeader(row, employeeHeader, "hPool")),
        dPool: parseBool(cellByHeader(row, employeeHeader, "dPool")),
        pPool: parseBool(cellByHeader(row, employeeHeader, "pPool")),
        mPool: parseBool(cellByHeader(row, employeeHeader, "mPool")),
        mStandby: parseBool(cellByHeader(row, employeeHeader, "mStandby")),
        past: [
          normalizeRole(cellByHeader(row, employeeHeader, "D-4")),
          normalizeRole(cellByHeader(row, employeeHeader, "D-3")),
          normalizeRole(cellByHeader(row, employeeHeader, "D-2")),
          normalizeRole(cellByHeader(row, employeeHeader, "D-1"))
        ]
      };
    });

    const schedule = {};
    employees.forEach(employee => { schedule[employee.id] = {}; });
    const scheduleHeader = scheduleRows[0] || [];
    scheduleRows.slice(1).filter(row => row.some(Boolean)).forEach(row => {
      const employeeId = row[0];
      if (!employeeId || !schedule[employeeId]) return;
      for (let col = 2; col < scheduleHeader.length; col++) {
        const date = scheduleHeader[col];
        const role = normalizeRole(row[col]);
        if (isIsoDateString(date) && role) schedule[employeeId][date] = role;
      }
    });

    const manual = {};
    manualRows.slice(1).forEach(row => {
      const employeeId = row[0];
      const date = row[1];
      if (employeeId && isIsoDateString(date)) manual[keyOf(employeeId, date)] = true;
    });

    const startDate = configMap.get("startDate") || state.config.startDate;
    const endDate = configMap.get("endDate") || state.config.endDate;
    return {
      config: {
        startDate,
        endDate,
        holidays: holidayRows.slice(1).map(row => row[0]).filter(isIsoDateString),
        targetOffDays: clampNumber(configMap.get("targetOffDays"), 0, 31, state.config.targetOffDays),
        maxConsecutive: clampNumber(configMap.get("maxConsecutive"), 3, 10, state.config.maxConsecutive),
        shuffleSeed: configMap.get("shuffleSeed") || "",
        hProtection: parseBool(configMap.get("hProtection") || "true"),
        nGap: clampNumber(configMap.get("nGap"), 2, 10, state.config.nGap),
        minActive: clampNumber(configMap.get("minActive"), 1, 30, state.config.minActive),
        minEs: clampNumber(configMap.get("minEs"), 1, 30, state.config.minEs),
        fridayDs: clampNumber(configMap.get("fridayDs"), 1, 10, state.config.fridayDs)
      },
      employees,
      schedule,
      manual,
      ui: {
        panelCollapsed: parseBool(configMap.get("panelCollapsed")),
        editMode: configMap.get("editMode") === "validate" ? "validate" : "setup"
      }
    };
  }

  function stateFromLegacyScheduleCsv(rows) {
    const header = rows[0] || [];
    if (!header.length || header[0] !== "이름") throw new Error("지원하지 않는 CSV 형식입니다.");
    const dateStart = header.findIndex(cell => isIsoDateString(cell));
    if (dateStart === -1) throw new Error("날짜 열을 찾지 못했습니다.");
    const dates = header.slice(dateStart).filter(isIsoDateString);
    const employees = [];
    const schedule = {};

    rows.slice(1).filter(row => row.some(Boolean)).forEach((row, index) => {
      const employee = {
        id: `emp-${index + 100}`,
        name: row[0] || `직원 ${index + 1}`,
        group: GROUPS.includes(row[1]) ? row[1] : "일반직",
        plusOne: false,
        nwPool: false,
        hPool: false,
        dPool: false,
        pPool: false,
        mPool: false,
        mStandby: false,
        past: [normalizeRole(row[3]), normalizeRole(row[4]), normalizeRole(row[5]), normalizeRole(row[6])]
      };
      employees.push(employee);
      schedule[employee.id] = {};
      dates.forEach((date, offset) => {
        const role = normalizeRole(row[dateStart + offset]);
        if (role) schedule[employee.id][date] = role;
      });
    });

    if (!employees.length) throw new Error("직원 데이터가 없습니다.");
    return {
      config: {
        ...state.config,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        holidays: []
      },
      employees,
      schedule,
      manual: {},
      ui: { ...(state.ui || { panelCollapsed: false, editMode: "setup" }) }
    };
  }

  function inputCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.value = value;
    input.addEventListener("change", () => onChange(input.value.trim()));
    td.appendChild(input);
    return td;
  }

  function selectCell(options, value, onChange) {
    const td = document.createElement("td");
    const select = document.createElement("select");
    options.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      select.appendChild(opt);
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    td.appendChild(select);
    return td;
  }

  function roleSelectCell(value, onChange) {
    return selectCell(["", ...Object.keys(ROLE_DEFS)], value, onChange);
  }

  function checkCell(value, onChange) {
    const td = document.createElement("td");
    td.className = "check-cell";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
    input.addEventListener("change", () => onChange(input.checked));
    td.appendChild(input);
    return td;
  }

  function setActiveTab(tabId, viewId) {
    ["scheduleTab", "staffTab", "statsTab", "issuesTab"].forEach(id => {
      el[id].classList.toggle("active", id === tabId);
      el[id].setAttribute("aria-selected", String(id === tabId));
    });
    ["scheduleView", "staffView", "statsView", "issuesView"].forEach(id => {
      el[id].hidden = id !== viewId;
    });
    if (viewId === "staffView") window.requestAnimationFrame(syncStaffHorizontalScroll);
  }

  function showNotice(message) {
    el.notice.textContent = message;
    el.notice.hidden = false;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { el.notice.hidden = true; }, 4000);
  }

  function updateSummary() {
    const days = getScheduleDays();
    el.scheduleSummary.textContent = `${state.config.startDate} ~ ${state.config.endDate} · ${state.employees.length}명 · ${days.length}일`;
  }

  function getPools() {
    const standard = [];
    const dispatch = [];
    const nw = [];
    const h = [];
    const d = [];
    const p = [];
    const m = [];
    const mStandby = [];
    state.employees.forEach((employee, index) => {
      if (employee.group === "파견직") dispatch.push(index);
      else standard.push(index);
      if (employee.nwPool) nw.push(index);
      if (employee.hPool) h.push(index);
      if (employee.dPool) d.push(index);
      if (employee.pPool) p.push(index);
      if (employee.mPool) m.push(index);
      if (employee.mStandby) mStandby.push(index);
    });
    return { standard, dispatch, nw, h, d, p, m, mStandby };
  }

  function getNightPool() {
    const pools = getPools();
    return pools.nw.length ? pools.nw : pools.standard;
  }

  function getScheduleDays() {
    const start = parseIsoDate(state.config.startDate);
    const end = parseIsoDate(state.config.endDate);
    if (!start || !end || end < start) return [];
    const days = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      days.push(new Date(cursor));
    }
    return days;
  }

  function getRole(employeeId, date) {
    return state.schedule[employeeId]?.[date] || "";
  }

  function applyRoleRaw(employeeId, date, role) {
    if (!state.schedule[employeeId]) state.schedule[employeeId] = {};
    const normalized = String(role || "").trim().toUpperCase();
    if (normalized) state.schedule[employeeId][date] = normalized;
    else delete state.schedule[employeeId][date];
  }

  function markLastChangedCells(keys) {
    state.ui ||= {};
    state.ui.lastChangedCells = [...new Set(keys.filter(Boolean))];
  }

  function isProtectedScheduleCell(employeeId, date, role) {
    return Boolean(state.manual[keyOf(employeeId, date)] || getProtectedRoles().includes(role));
  }


  function isHProtectionEnabled() {
    return state.config?.hProtection !== false;
  }

  function getProtectedRoles() {
    return isHProtectionEnabled() ? [...BASE_PROTECTED_ROLES, "H"] : BASE_PROTECTED_ROLES;
  }

  function isDateInSchedule(date) {
    return getScheduleDays().some(day => toIsoDate(day) === date);
  }

  function getTargetOff(employee) {
    return state.config.targetOffDays + (employee.plusOne ? 1 : 0);
  }

  function countDayRoles(date, roles) {
    return state.employees.reduce((sum, employee) => sum + (roles.includes(getRole(employee.id, date)) ? 1 : 0), 0);
  }

  function countRolesForDay(date) {
    const counts = {};
    state.employees.forEach(employee => {
      const role = getRole(employee.id, date);
      if (!role) return;
      counts[role] = (counts[role] || 0) + 1;
    });
    return counts;
  }

  function countDayActive(data, d) {
    let count = 0;
    for (let i = 0; i < data.length; i++) {
      if (["E", "S", "D", "P"].includes(data[i][d])) count++;
    }
    return count;
  }

  function countDayEs(data, d) {
    let count = 0;
    for (let i = 0; i < data.length; i++) {
      if (["E", "S"].includes(data[i][d])) count++;
    }
    return count;
  }

  function getWeekendNWPattern(date) {
    const day = date.getDay();
    if (day === 5) return "FRI_SAT_NW";
    if (day === 6) return "SAT_SUN_NW";
    const next = addDays(date, 1);
    if (!isWeekend(date) && isHoliday(next)) return "HOLIDAY_EVE_NW";
    return "";
  }

  function getWeekendNWPatternLabel(pattern) {
    return {
      FRI_SAT_NW: "금-토 N/W",
      SAT_SUN_NW: "토-일 N/W",
      HOLIDAY_EVE_NW: "공휴일 전날 N/W"
    }[pattern] || pattern;
  }

  function getWeekendNWPenalty(data, days, employees, employeeIndex, currentDay) {
    const pattern = getWeekendNWPattern(days[currentDay]);
    if (!pattern) return 0;
    const samePatternCount = countWeekendNWPattern(data, days, employeeIndex, currentDay, pattern);
    const totalCount = countWeekendNWTotal(data, days, employeeIndex, currentDay);
    const recentCount = countRecentWeekendNW(data, days, employeeIndex, currentDay, 8);
    return samePatternCount * 100000 + recentCount * 50000 + totalCount * 12000;
  }

  function countWeekendNWPattern(data, days, employeeIndex, untilDay, pattern) {
    let count = 0;
    for (let d = 0; d < untilDay; d++) {
      if (data[employeeIndex][d] === "N" && getWeekendNWPattern(days[d]) === pattern) count++;
    }
    return count;
  }

  function countWeekendNWTotal(data, days, employeeIndex, untilDay) {
    let count = 0;
    for (let d = 0; d < untilDay; d++) {
      if (data[employeeIndex][d] === "N" && getWeekendNWPattern(days[d])) count++;
    }
    return count;
  }

  function countRecentWeekendNW(data, days, employeeIndex, currentDay, windowDays) {
    let count = 0;
    for (let d = Math.max(0, currentDay - windowDays); d < currentDay; d++) {
      if (data[employeeIndex][d] === "N" && getWeekendNWPattern(days[d])) count++;
    }
    return count;
  }

  function hasRecentNightWakePair(data, employees, employeeIndex, currentDay, windowDays) {
    for (let d = currentDay - 1; d >= currentDay - windowDays; d--) {
      if (d < -4) break;
      const role = d < 0 ? employees[employeeIndex].past[4 + d] : data[employeeIndex][d];
      if (role === "N" || role === "W") return true;
    }
    return false;
  }

  function hasFutureNightWakePair(data, employeeIndex, currentDay, windowDays) {
    for (let d = currentDay + 1; d <= currentDay + windowDays && d < data[employeeIndex].length; d++) {
      const role = data[employeeIndex][d];
      if (role === "N" || role === "W") return true;
    }
    return false;
  }

  function findNextNightWithin(data, employeeIndex, currentDay, windowDays) {
    for (let d = currentDay + 1; d <= currentDay + windowDays && d < data[employeeIndex].length; d++) {
      if (data[employeeIndex][d] === "N") return d;
    }
    return -1;
  }

  function validateNightWakeAlternation(days, issues) {
    state.employees.forEach(employee => {
      for (let d = 0; d <= days.length - 4; d++) {
        const roles = [0, 1, 2, 3].map(offset => getRole(employee.id, toIsoDate(days[d + offset])));
        if (roles.join("|") === "N|W|N|W") {
          issues.push({
            title: "N/W 격일 반복",
            message: `${employee.name} ${toIsoDate(days[d])}~${toIsoDate(days[d + 3])}: N-W-N-W 패턴입니다.`,
            empId: employee.id,
            date: toIsoDate(days[d + 2])
          });
        }
      }
      for (let d = 0; d < days.length; d++) {
        const role = getRole(employee.id, toIsoDate(days[d]));
        if (role !== "N") continue;
        for (let k = d + 1; k <= d + 3 && k < days.length; k++) {
          const nextRole = getRole(employee.id, toIsoDate(days[k]));
          if (nextRole === "N") {
            issues.push({
              title: "N/W 재배치 간격 위반",
              message: `${employee.name} ${toIsoDate(days[d])} N 이후 ${toIsoDate(days[k])}에 다시 N이 배치되었습니다.`,
              empId: employee.id,
              date: toIsoDate(days[k])
            });
          }
        }
      }
    });
  }

  function validateWeekendNWPatterns(days, issues) {
    const totals = [];
    state.employees.forEach(employee => {
      const patternCounts = {};
      let total = 0;
      days.forEach(day => {
        const dateKey = toIsoDate(day);
        if (getRole(employee.id, dateKey) !== "N") return;
        const pattern = getWeekendNWPattern(day);
        if (!pattern) return;
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
        total++;
        if (patternCounts[pattern] > 1) {
          issues.push({
            title: "주말 N/W 반복",
            message: `${employee.name} ${dateKey}: ${getWeekendNWPatternLabel(pattern)}가 이번 근무표에서 ${patternCounts[pattern]}회째입니다.`,
            empId: employee.id,
            date: dateKey
          });
        }
      });
      totals.push({ employee, total });
    });

    const activeTotals = totals.filter(item => item.total > 0);
    if (activeTotals.length < 2) return;
    const max = Math.max(...totals.map(item => item.total));
    const min = Math.min(...totals.map(item => item.total));
    if (max - min >= 2) {
      const overloaded = totals.filter(item => item.total === max).map(item => item.employee.name).join(", ");
      issues.push({
        title: "주말 N/W 편중",
        message: `주말 N/W 총량 차이가 ${max - min}회입니다. 편중 인원: ${overloaded}`
      });
    }
  }

  function countEmployeeRole(data, employeeIndex, role, untilDay) {
    let count = 0;
    for (let d = 0; d <= untilDay; d++) if (data[employeeIndex][d] === role) count++;
    return count;
  }

  function countCritical(data, employeeIndex, untilDay) {
    let count = 0;
    for (let d = 0; d <= untilDay; d++) if (CRITICAL_ROLES.includes(data[employeeIndex][d])) count++;
    return count;
  }

  function countOff(row) {
    return row.filter(role => role === "X" || role === "R").length;
  }

  function hasRoleOnDay(data, d, role) {
    return data.some(row => row[d] === role);
  }

  function hasNearbyRole(data, employees, idx, d, role, gap) {
    for (let k = d - gap; k < d; k++) {
      if (k < 0) {
        if (employees[idx].past[4 + k] === role) return true;
      } else if (data[idx][k] === role) return true;
    }
    return false;
  }

  function daysSinceLastRole(data, employees, idx, d, role) {
    for (let k = d - 1; k >= -4; k--) {
      if (k < 0) {
        if (employees[idx].past[4 + k] === role) return d - k;
      } else if (data[idx][k] === role) {
        return d - k;
      }
    }
    return 999;
  }

  function isAfterWake(data, employees, idx, d) {
    if (d <= 0) return employees[idx].past[3] === "W";
    return data[idx][d - 1] === "W";
  }

  function getPastConsecutive(employee) {
    let streak = 0;
    employee.past.forEach(role => {
      if (isRestRole(role) || !role) streak = 0;
      else streak++;
    });
    return streak;
  }

  function getStreakLength(data, employee, idx, day) {
    let length = 1;
    for (let d = day - 1; d >= -4; d--) {
      const role = d < 0 ? employee.past[4 + d] : data[idx][d];
      if (isRestRole(role) || !role) break;
      length++;
    }
    for (let d = day + 1; d < data[idx].length; d++) {
      const role = data[idx][d];
      if (isRestRole(role) || !role) break;
      length++;
    }
    return length;
  }

  function wouldViolateConsecutive(data, employee, idx, day, role) {
    const original = data[idx][day];
    data[idx][day] = role;
    let streak = getPastConsecutive(employee);
    let violated = false;
    for (let d = 0; d < data[idx].length; d++) {
      if (isRestRole(data[idx][d]) || !data[idx][d]) streak = 0;
      else {
        streak++;
        if (streak > state.config.maxConsecutive) {
          violated = true;
          break;
        }
      }
    }
    data[idx][day] = original;
    return violated;
  }

  function wouldBreakWeekendGeneral(data, employees, day, d, employeeIndexToRest) {
    if (!isWeekend(day) || employees[employeeIndexToRest].group === "파견직") return false;
    let count = 0;
    for (let i = 0; i < employees.length; i++) {
      if (i === employeeIndexToRest) continue;
      if (employees[i].group !== "파견직" && ["D", "S"].includes(data[i][d])) count++;
    }
    return count < state.config.fridayDs;
  }

  function weekendFairnessScore(data, idx, currentDay) {
    let fullWeekendOff = 0;
    for (let d = 1; d < currentDay; d++) {
      const day = addDays(parseIsoDate(state.config.startDate), d);
      if (day.getDay() === 0 && ["R", "X", "A"].includes(data[idx][d]) && ["R", "X", "A"].includes(data[idx][d - 1])) {
        fullWeekendOff++;
      }
    }
    return fullWeekendOff * 5000;
  }

  function pointerDistance(pool, pointer, employeeIndex) {
    const pos = pool.indexOf(employeeIndex);
    if (pos === -1) return 999;
    return (pos - pointer + pool.length) % pool.length;
  }

  function applyRoleStyle(node, role) {
    if (!role || !ROLE_DEFS[role]) {
      node.style.background = "#eef2f5";
      node.style.color = "#62717d";
      return;
    }
    node.style.background = ROLE_DEFS[role].bg;
    node.style.color = ROLE_DEFS[role].fg;
  }

  function isWorkingRole(role) {
    return Boolean(role) && !REST_ROLES.includes(role);
  }

  function isMRole(role) {
    return ["M1", "M2", "M3"].includes(String(role || "").trim().toUpperCase());
  }


  function canPrecedeH(role) {
    return !role || ["E", "R", "X", "W", "A", "H"].includes(role);
  }

  function isRestRole(role) {
    return REST_ROLES.includes(role);
  }

  function isWeekend(date) {
    return date.getDay() === 0 || date.getDay() === 6;
  }

  function isHoliday(date) {
    return state.config.holidays.includes(toIsoDate(date));
  }

  function isRedDay(date) {
    return isWeekend(date) || isHoliday(date);
  }

  function weekdayName(date) {
    return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  }

  function dayIndex(date) {
    const start = parseIsoDate(state.config.startDate);
    return Math.round((date - start) / 86400000);
  }

  function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseIsoDate(value) {
    if (!value) return null;
    const [y, m, d] = value.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function clampNumber(value, min, max, fallback) {
    const number = parseInt(value, 10);
    if (Number.isNaN(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function keyOf(employeeId, date) {
    return `${employeeId}|${date}`;
  }

  function issueSignature(issue) {
    return `${issue.title}|${issue.empId || ""}|${issue.date || ""}`;
  }

  function isFormControl(target) {
    if (!target) return false;
    const tagName = target.tagName;
    return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(tagName);
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function parseCsv(text) {
    const cleanText = text.replace(/^\ufeff/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const next = cleanText[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    row.push(cell);
    rows.push(row);
    return rows.filter(csvRow => csvRow.some(value => value !== ""));
  }

  function getCsvSection(rows, sectionName) {
    const start = rows.findIndex(row => row[0] === sectionName);
    if (start === -1) return [];
    const sectionRows = [];
    for (let i = start + 1; i < rows.length; i++) {
      if (/^\[.+\]$/.test(rows[i][0] || "")) break;
      if (rows[i].some(Boolean)) sectionRows.push(rows[i]);
    }
    return sectionRows;
  }

  function cellByHeader(row, header, name) {
    const index = header.indexOf(name);
    return index === -1 ? "" : row[index] || "";
  }

  function parseBool(value) {
    return ["true", "1", "yes", "y", "o", "ㅇ", "예"].includes(String(value || "").trim().toLowerCase());
  }

  function normalizeRole(value) {
    const role = String(value || "").trim().toUpperCase();
    return ROLE_DEFS[role] ? role : "";
  }

  function isIsoDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function getScheduleSeed() {
    const employeeSeedPart = state.employees.map(employee => `${employee.id}:${employee.name}:${employee.group}`).join("|");
    const userSeed = state.config.shuffleSeed || "auto";
    return `${state.config.startDate}|${state.config.endDate}|${userSeed}|${employeeSeedPart}`;
  }

  function seededShuffle(items, seed) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(seededNoise(`${seed}|${i}`) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function seededNoise(seed) {
    let hash = 2166136261;
    const text = String(seed);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return (hash >>> 0) / 4294967296;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function pushHistory(label) {
    const snapshot = JSON.stringify({ state, latestIssues });
    if (historyStack[historyStack.length - 1]?.snapshot === snapshot) return;
    historyStack.push({ label, snapshot });
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
  }

  function undoLastChange() {
    const entry = historyStack.pop();
    if (!entry) {
      showNotice("되돌릴 작업이 없습니다.");
      return;
    }
    try {
      const scrollPosition = captureScrollPosition();
      const restored = JSON.parse(entry.snapshot);
      state = restored.state;
      latestIssues = restored.latestIssues || [];
      refreshEmployeeSeed();
      syncInputs();
      renderAll();
      restoreScrollPosition(scrollPosition);
      saveState();
      showNotice(`되돌림: ${entry.label}`);
    } catch {
      showNotice("되돌리기에 실패했습니다.");
    }
  }

  function captureScrollPosition() {
    const scheduleWrap = el.scheduleTable?.closest(".schedule-wrap");
    return {
      windowX: window.scrollX,
      windowY: window.scrollY,
      scheduleLeft: scheduleWrap?.scrollLeft || 0,
      scheduleTop: scheduleWrap?.scrollTop || 0
    };
  }

  function restoreScrollPosition(position) {
    const apply = () => {
      const scheduleWrap = el.scheduleTable?.closest(".schedule-wrap");
      if (scheduleWrap) {
        scheduleWrap.scrollLeft = position.scheduleLeft;
        scheduleWrap.scrollTop = position.scheduleTop;
      }
      window.scrollTo(position.windowX, position.windowY);
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  function refreshEmployeeSeed() {
    employeeSeed = Math.max(100, ...state.employees.map(emp => parseInt(String(emp.id).replace(/\D/g, ""), 10) || 0)) + 1;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.employees || !parsed?.config) return null;
      parsed.config.holidays ||= [];
      parsed.config.shuffleSeed ||= "";
      parsed.config.hProtection = parsed.config.hProtection !== false;
      parsed.schedule ||= {};
      parsed.manual ||= {};
      parsed.ui ||= { panelCollapsed: false };
      parsed.ui.editMode ||= "setup";
      parsed.employees.forEach(employee => {
        employee.past ||= ["", "", "", ""];
        employee.plusOne = Boolean(employee.plusOne);
        employee.nwPool = Boolean(employee.nwPool);
        employee.hPool = Boolean(employee.hPool);
        employee.dPool = Boolean(employee.dPool);
        employee.pPool = Boolean(employee.pPool);
        employee.mPool = Boolean(employee.mPool);
        employee.mStandby = Boolean(employee.mStandby);
      });
      return parsed;
    } catch {
      return null;
    }
  }
})();
