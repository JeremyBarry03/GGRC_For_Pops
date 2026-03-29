const state = {
  summaryRows: [],
  fileName: "",
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

generateButton.addEventListener("click", async () => {
  const file = csvFileInput.files[0];
  if (!file) {
    setStatus("Choose a CSV file first.");
    return;
  }

  try {
    const rawText = await file.text();
    const rows = parseCsv(rawText);
    syncWeekOptions(extractWeeks(rows));
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
});

downloadButton.addEventListener("click", () => {
  if (!state.summaryRows.length) {
    return;
  }

  const csvText = toCsv([
    ["Coach", "Position-AgeGrp", "Count"],
    ...state.summaryRows.map((row) => [row.Coach, row["Position-AgeGrp"], row.Count ?? ""]),
  ]);

  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.fileName || "coach_summary"}_summary.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

function setStatus(message) {
  statusNode.textContent = message;
}

function renderSummary(rows) {
  if (!rows.length) {
    summaryMetaNode.textContent = "No summary generated yet.";
    summaryBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="3">No data yet.</td>
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
    summaryRows.push({
      Coach: coach,
      "Position-AgeGrp": positionAgeGroup,
      Count: count,
    });
  }

  for (const coach of [...excludedCoaches.values()].sort((left, right) => left.localeCompare(right))) {
    summaryRows.push({
      Coach: coach,
      "Position-AgeGrp": "EXCLUDE",
      Count: null,
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

  weeksPicker.innerHTML = weeks
    .map(
      (week) => `
        <label class="week-pill">
          <input type="checkbox" value="${week}" ${week <= 2 ? "checked" : ""}>
          <span>Week ${week}</span>
        </label>
      `,
    )
    .join("");
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
