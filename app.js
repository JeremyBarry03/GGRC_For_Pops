const RATE_STORAGE_KEY = "coach-summary-rates";
const state = {
  summaryRows: [],
  fileName: "",
  rates: loadRates(),
};
const DEFAULT_NAME_CORRECTIONS = new Map([
  ["caitln", "Caitlin"],
]);

const csvFileInput = document.getElementById("csvFile");
const weeksPicker = document.getElementById("weeksPicker");
const excludeInput = document.getElementById("excludeInput");
const generateButton = document.getElementById("generateButton");
const downloadButton = document.getElementById("downloadButton");
const statusNode = document.getElementById("status");
const summaryMetaNode = document.getElementById("summaryMeta");
const summaryBody = document.getElementById("summaryBody");

const WEEK_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

csvFileInput.addEventListener("change", async () => {
  const file = csvFileInput.files[0];
  if (!file) {
    return;
  }

  try {
    const rawText = await file.text();
    const rows = parseCsv(rawText);
    syncWeekOptions(extractWeeks(rows));
    const refreshButton = getRefreshButton();
    if (refreshButton) {
      refreshButton.disabled = false;
    }
    setStatus("File loaded. Choose the weeks, then click Generate summary.");
  } catch (error) {
    setStatus(error.message || "Could not read the CSV file.");
  }
});

generateButton.addEventListener("click", async () => {
  await runSummary();
});

bindRefreshButton();

weeksPicker.addEventListener("change", () => {
  if (csvFileInput.files[0]) {
    setStatus("Week changes are ready. Click Refresh preview.");
  }
});

excludeInput.addEventListener("input", () => {
  if (csvFileInput.files[0]) {
    setStatus("Filter changes are ready. Click Refresh preview.");
  }
});

async function runSummary() {
  const file = csvFileInput.files[0];
  if (!file) {
    setStatus("Choose a CSV file first.");
    return;
  }

  try {
    const rawText = await file.text();
    const rows = parseCsv(rawText);
    const selectedWeeks = getSelectedWeeks();
    if (!selectedWeeks.size) {
      setStatus("Select at least one week.");
      downloadButton.disabled = true;
      renderSummary([]);
      return;
    }
    const summaryRows = buildSummary(rows, {
      nameCorrections: DEFAULT_NAME_CORRECTIONS,
      excludeNames: parseCommaList(excludeInput.value).map((item) => item.toLowerCase()),
      includedWeeks: selectedWeeks,
    });

    state.summaryRows = summaryRows;
    state.fileName = file.name.replace(/\.csv$/i, "") || "coach_summary";

    renderSummary(summaryRows);
    downloadButton.disabled = summaryRows.length === 0;
    setStatus(`Generated ${summaryRows.length} summary row${summaryRows.length === 1 ? "" : "s"}.`);
  } catch (error) {
    downloadButton.disabled = true;
    renderSummary([]);
    setStatus(error.message || "Could not generate the summary.");
  }
}

downloadButton.addEventListener("click", () => {
  if (!state.summaryRows.length) {
    return;
  }

  const csvText = toCsv([
    ["Coach", "Position-AgeGrp", "Count", "Rate Per Session"],
    ...state.summaryRows.map((row) => [
      row.Coach,
      row["Position-AgeGrp"],
      row.Count ?? "",
      row["Rate Per Session"] ?? "",
    ]),
  ]);

  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.fileName || "coach_summary"}_summary.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

summaryBody.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches(".rate-input")) {
    return;
  }

  const rowKey = target.dataset.rowKey;
  if (!rowKey) {
    return;
  }

  const cleanedValue = normalizeRate(target.value);
  target.value = cleanedValue;
  state.rates[rowKey] = cleanedValue;

  for (const row of state.summaryRows) {
    if (row.rowKey === rowKey) {
      row["Rate Per Session"] = cleanedValue;
      break;
    }
  }

  saveRates(state.rates);
});

function setStatus(message) {
  statusNode.textContent = message;
}

function renderSummary(rows) {
  if (!rows.length) {
    summaryMetaNode.textContent = "No summary generated yet.";
    summaryBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">No data yet.</td>
      </tr>
    `;
    return;
  }

  summaryMetaNode.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} ready to review or download.`;
  summaryBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.Coach)}</td>
          <td>${escapeHtml(row["Position-AgeGrp"])}</td>
          <td>${row.Count ?? ""}</td>
          <td>
            <div class="rate-cell">
              <span class="rate-prefix">$</span>
              <input
                class="rate-input"
                type="text"
                inputmode="numeric"
                placeholder="0"
                value="${escapeAttribute(row["Rate Per Session"] ?? "")}"
                data-row-key="${escapeAttribute(row.rowKey)}"
              >
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
}

function buildSummary(rows, options) {
  const counts = new Map();
  const excludedCoaches = new Map();
  let currentCategory = "";
  let currentWeek = null;

  for (const row of rows) {
    if (row.length < 3) {
      continue;
    }

    const categoryText = asCellText(row[0]);
    const roleText = asCellText(row[1]);
    const coachValues = row.slice(2, 9);

    if (categoryText.startsWith("Session ")) {
      currentWeek = extractWeekNumber(categoryText);
      currentCategory = "";
      continue;
    }

    if (options.includedWeeks && !options.includedWeeks.has(currentWeek)) {
      continue;
    }

    if (categoryText === "Date" || categoryText === "Time" || categoryText === "PRIVATE LESSON") {
      continue;
    }

    if (categoryText) {
      currentCategory = categoryText;
    } else if (!currentCategory) {
      continue;
    }

    const role = getRole(roleText);
    if (!role) {
      continue;
    }

    const ageGroup = getAgeGroup(currentCategory);
    const positionAgeGroup = `${role}-${ageGroup}`;

    for (const coachRaw of coachValues) {
      const coach = normalizeName(coachRaw, options.nameCorrections);
      if (!coach) {
        continue;
      }

      const coachKey = coach.toLowerCase();
      if (options.excludeNames.includes(coachKey)) {
        if (!excludedCoaches.has(coachKey)) {
          excludedCoaches.set(coachKey, coach);
        }
        continue;
      }

      const countKey = `${coach}|||${positionAgeGroup}`;
      counts.set(countKey, (counts.get(countKey) || 0) + 1);
    }
  }

  const summaryRows = [];
  for (const [countKey, count] of counts.entries()) {
    const [coach, positionAgeGroup] = countKey.split("|||");
    const rowKey = `${coach}|||${positionAgeGroup}`;
    summaryRows.push({
      Coach: coach,
      "Position-AgeGrp": positionAgeGroup,
      Count: count,
      "Rate Per Session": state.rates[rowKey] ?? "",
      rowKey,
    });
  }

  for (const coach of [...excludedCoaches.values()].sort((left, right) => left.localeCompare(right))) {
    const rowKey = `${coach}|||EXCLUDE`;
    summaryRows.push({
      Coach: coach,
      "Position-AgeGrp": "EXCLUDE",
      Count: null,
      "Rate Per Session": state.rates[rowKey] ?? "",
      rowKey,
    });
  }

  summaryRows.sort((left, right) => {
    const coachCompare = left.Coach.localeCompare(right.Coach);
    if (coachCompare !== 0) {
      return coachCompare;
    }
    return left["Position-AgeGrp"].localeCompare(right["Position-AgeGrp"]);
  });

  return summaryRows;
}

function normalizeName(value, nameCorrections) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  const key = cleaned.toLowerCase();
  if (key === "xxx" || key === "-" || key === "n/a") {
    return null;
  }

  return nameCorrections.get(key) || cleaned;
}

function normalizeRate(value) {
  const cleaned = String(value ?? "").replace(/\D+/g, "");
  if (!cleaned) {
    return "";
  }
  return String(Number.parseInt(cleaned, 10));
}

function getAgeGroup(categoryValue) {
  return categoryValue.toLowerCase().includes("youth") ? "Youth" : "Adult";
}

function getRole(roleValue) {
  const lowered = roleValue.toLowerCase();
  if (lowered.startsWith("head")) {
    return "Head";
  }
  if (lowered.startsWith("asst") || lowered.startsWith("assistant")) {
    return "Asst";
  }
  return null;
}

function parseCommaList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractWeeks(rows) {
  const weeks = new Set();
  for (const row of rows) {
    const categoryText = asCellText(row[0]);
    if (!categoryText.startsWith("Session ")) {
      continue;
    }
    const weekNumber = extractWeekNumber(categoryText);
    if (weekNumber !== null) {
      weeks.add(weekNumber);
    }
  }
  return [...weeks].sort((left, right) => left - right);
}

function syncWeekOptions(weeks) {
  if (!weeks.length) {
    return;
  }

  const previousSelection = getSelectedWeeks();

  weeksPicker.innerHTML = weeks
    .map(
      (week) => `
        <label class="week-pill">
          <input type="checkbox" value="${week}" ${getWeekCheckedState(week, previousSelection)}>
          <span>Week ${week}</span>
        </label>
      `,
    )
    .join("")
    .concat(`
      <button id="refreshButton" class="refresh-wheel" type="button" aria-label="Refresh preview" title="Refresh preview" ${csvFileInput.files[0] ? "" : "disabled"}>
        <span aria-hidden="true">&#8635;</span>
      </button>
    `);

  bindRefreshButton();
}

function getWeekCheckedState(week, previousSelection) {
  if (previousSelection.has(week)) {
    return "checked";
  }
  if (previousSelection.size === 0 && week <= 2) {
    return "checked";
  }
  return "";
}

function bindRefreshButton() {
  const nextRefreshButton = getRefreshButton();
  if (!nextRefreshButton) {
    return;
  }
  nextRefreshButton.addEventListener("click", async () => {
    await runSummary();
  });
}

function getRefreshButton() {
  return document.getElementById("refreshButton");
}

function getSelectedWeeks() {
  const checked = [...weeksPicker.querySelectorAll('input[type="checkbox"]:checked')];
  return new Set(
    checked
      .map((input) => Number.parseInt(input.value, 10))
      .filter((value) => !Number.isNaN(value)),
  );
}

function extractWeekNumber(value) {
  const lowered = value.toLowerCase();
  for (const [word, number] of Object.entries(WEEK_WORDS)) {
    if (lowered.includes(`week ${word}`)) {
      return number;
    }
  }
  return null;
}

function asCellText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          if (text.includes('"') || text.includes(",") || text.includes("\n")) {
            return `"${text.replace(/"/g, '""')}"`;
          }
          return text;
        })
        .join(","),
    )
    .join("\r\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function loadRates() {
  try {
    const raw = window.localStorage.getItem(RATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveRates(rates) {
  try {
    window.localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(rates));
  } catch {
    return;
  }
}
