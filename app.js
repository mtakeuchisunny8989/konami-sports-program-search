(() => {
  "use strict";

  const STORAGE_KEY = "ksc-search-conditions-v1";
  const DATA_URL = "data/programs.json";

  /** @type {{facilities: any[], programs: any[], fetched_at: string}} */
  let dataset = { facilities: [], programs: [], fetched_at: null };
  let facilityByCode = new Map();

  const state = {
    date: "ALL",
    programQuery: "",
    instructorQuery: "",
    prefecture: "",
    facility: "",
    timeRange: "",
    sort: "datetime",
  };

  const el = {
    fetchedAt: document.getElementById("fetchedAt"),
    dateRow: document.getElementById("dateRow"),
    programInput: document.getElementById("programInput"),
    instructorInput: document.getElementById("instructorInput"),
    prefSelect: document.getElementById("prefSelect"),
    facilitySelect: document.getElementById("facilitySelect"),
    timeSelect: document.getElementById("timeSelect"),
    sortSelect: document.getElementById("sortSelect"),
    resultCount: document.getElementById("resultCount"),
    resultList: document.getElementById("resultList"),
    emptyMessage: document.getElementById("emptyMessage"),
  };

  // ---- 検索用正規化(ひらがな/カタカナ・全角半角・大小文字を無視) ----
  function normalize(s) {
    if (!s) return "";
    let n = s.normalize("NFKC").toLowerCase();
    n = n.replace(/[ァ-ヶ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
    return n;
  }

  function loadSavedConditions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.assign(state, saved);
    } catch (e) {
      /* localStorageが使えない/壊れている場合は無視 */
    }
  }

  function saveConditions() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 保存できなくても検索自体は継続可能 */
    }
  }

  function formatDateLabel(dateStr, weekday, isHoliday) {
    const [, m, d] = dateStr.split("-");
    const mm = parseInt(m, 10);
    const dd = parseInt(d, 10);
    return `${mm}/${dd}(${weekday}${isHoliday ? "・祝" : ""})`;
  }

  function buildDateChips() {
    const dateMap = new Map(); // dateStr -> {weekday, isHoliday}
    for (const p of dataset.programs) {
      if (!dateMap.has(p.date)) {
        dateMap.set(p.date, { weekday: p.weekday, isHoliday: p.is_holiday });
      }
    }
    const dates = Array.from(dateMap.keys()).sort();

    el.dateRow.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "date-chip";
    allChip.textContent = "全日";
    allChip.dataset.value = "ALL";
    el.dateRow.appendChild(allChip);

    for (const dateStr of dates) {
      const info = dateMap.get(dateStr);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "date-chip";
      chip.textContent = formatDateLabel(dateStr, info.weekday, info.isHoliday);
      chip.dataset.value = dateStr;
      el.dateRow.appendChild(chip);
    }

    if (state.date !== "ALL" && !dates.includes(state.date)) {
      state.date = "ALL";
    }

    el.dateRow.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".date-chip");
      if (!btn) return;
      state.date = btn.dataset.value;
      syncDateChipUI();
      onFilterChanged();
    });

    syncDateChipUI();
  }

  function syncDateChipUI() {
    for (const chip of el.dateRow.querySelectorAll(".date-chip")) {
      chip.classList.toggle("selected", chip.dataset.value === state.date);
    }
  }

  function buildPrefectureOptions() {
    const seen = new Map(); // code -> name
    for (const f of dataset.facilities) {
      seen.set(f.prefecture_code, f.prefecture);
    }
    const entries = Array.from(seen.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    el.prefSelect.innerHTML = '<option value="">すべて</option>';
    for (const [code, name] of entries) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = name;
      el.prefSelect.appendChild(opt);
    }
    el.prefSelect.value = state.prefecture;
  }

  function buildFacilityOptions() {
    const facilities = dataset.facilities
      .filter((f) => !state.prefecture || f.prefecture_code === state.prefecture)
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    el.facilitySelect.innerHTML = '<option value="">すべて</option>';
    for (const f of facilities) {
      const opt = document.createElement("option");
      opt.value = f.code;
      opt.textContent = f.name;
      el.facilitySelect.appendChild(opt);
    }

    const stillValid = facilities.some((f) => f.code === state.facility);
    if (!stillValid) state.facility = "";
    el.facilitySelect.value = state.facility;
  }

  function matchesTimeRange(startTime, rangeValue) {
    if (!rangeValue) return true;
    const [fromH, toH] = rangeValue.split(",").map(Number);
    const hour = parseInt(startTime.split(":")[0], 10);
    return hour >= fromH && hour < toH;
  }

  function applyFilters() {
    const programQ = normalize(state.programQuery);
    const instructorQ = normalize(state.instructorQuery);

    let results = dataset.programs.filter((p) => {
      if (state.date !== "ALL" && p.date !== state.date) return false;
      if (programQ && !normalize(p.program_name).includes(programQ)) return false;
      if (instructorQ && !normalize(p.instructor).includes(instructorQ)) return false;
      if (state.facility) {
        if (p.facility_code !== state.facility) return false;
      } else if (state.prefecture) {
        const fac = facilityByCode.get(p.facility_code);
        if (!fac || fac.prefecture_code !== state.prefecture) return false;
      }
      if (!matchesTimeRange(p.start_time, state.timeRange)) return false;
      return true;
    });

    if (state.sort === "facility") {
      results.sort((a, b) => {
        const fn = a.facility_name.localeCompare(b.facility_name, "ja");
        if (fn !== 0) return fn;
        const dt = a.date.localeCompare(b.date);
        if (dt !== 0) return dt;
        return a.start_time.localeCompare(b.start_time);
      });
    } else {
      results.sort((a, b) => {
        const dt = a.date.localeCompare(b.date);
        if (dt !== 0) return dt;
        return a.start_time.localeCompare(b.start_time);
      });
    }

    return results;
  }

  function renderResults() {
    const results = applyFilters();
    el.resultCount.textContent = `件数: ${results.length}件`;

    el.resultList.innerHTML = "";
    el.emptyMessage.hidden = results.length !== 0;

    const frag = document.createDocumentFragment();
    for (const p of results) {
      frag.appendChild(renderCard(p));
    }
    el.resultList.appendChild(frag);
  }

  function renderCard(p) {
    const card = document.createElement("article");
    card.className = "result-card";

    const row1 = document.createElement("div");
    row1.className = "row1";

    const dateBadge = document.createElement("span");
    dateBadge.className = "date-badge";
    dateBadge.textContent = formatDateLabel(p.date, p.weekday, p.is_holiday);
    row1.appendChild(dateBadge);

    const timeRange = document.createElement("span");
    timeRange.className = "time-range";
    timeRange.textContent = `${p.start_time}~${p.end_time}（${p.duration_min}分）`;
    row1.appendChild(timeRange);

    card.appendChild(row1);

    const programName = document.createElement("div");
    programName.className = "program-name";
    programName.textContent = p.program_name;
    card.appendChild(programName);

    const instructor = document.createElement("div");
    instructor.className = "instructor";
    instructor.textContent = `担当: ${p.instructor}`;
    card.appendChild(instructor);

    const facilityLink = document.createElement("a");
    facilityLink.className = "facility-link";
    facilityLink.textContent = `${p.facility_name} ›`;
    if (p.facility_url) {
      facilityLink.href = p.facility_url;
      facilityLink.target = "_blank";
      facilityLink.rel = "noopener noreferrer";
    }
    card.appendChild(facilityLink);

    return card;
  }

  function onFilterChanged() {
    saveConditions();
    renderResults();
  }

  function bindEvents() {
    el.programInput.addEventListener("input", () => {
      state.programQuery = el.programInput.value;
      onFilterChanged();
    });
    el.instructorInput.addEventListener("input", () => {
      state.instructorQuery = el.instructorInput.value;
      onFilterChanged();
    });
    el.prefSelect.addEventListener("change", () => {
      state.prefecture = el.prefSelect.value;
      state.facility = "";
      buildFacilityOptions();
      onFilterChanged();
    });
    el.facilitySelect.addEventListener("change", () => {
      state.facility = el.facilitySelect.value;
      onFilterChanged();
    });
    el.timeSelect.addEventListener("change", () => {
      state.timeRange = el.timeSelect.value;
      onFilterChanged();
    });
    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      onFilterChanged();
    });
  }

  function applyStateToInputs() {
    el.programInput.value = state.programQuery || "";
    el.instructorInput.value = state.instructorQuery || "";
    el.timeSelect.value = state.timeRange || "";
    el.sortSelect.value = state.sort || "datetime";
  }

  function formatFetchedAt(iso) {
    if (!iso) return "データ取得日時: 不明";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "データ取得日時: 不明";
    const pad = (n) => String(n).padStart(2, "0");
    return `データ取得日時: ${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(
      d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function init() {
    loadSavedConditions();
    applyStateToInputs();

    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dataset = await res.json();
    } catch (e) {
      el.fetchedAt.textContent = "データの読み込みに失敗しました。";
      el.emptyMessage.hidden = false;
      el.emptyMessage.textContent =
        "programs.json の読み込みに失敗しました。しばらくしてから再度お試しください。";
      console.error(e);
      return;
    }

    facilityByCode = new Map(dataset.facilities.map((f) => [f.code, f]));

    el.fetchedAt.textContent = formatFetchedAt(dataset.fetched_at);

    buildDateChips();
    buildPrefectureOptions();
    el.prefSelect.value = state.prefecture || "";
    buildFacilityOptions();

    bindEvents();
    renderResults();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  init();
})();
