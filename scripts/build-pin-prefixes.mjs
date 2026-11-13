// AP-039: writes public/data/pin-prefixes.json, the offline PIN-prefix -> GST state table the address inputs load lazily.
//
// India Post assigns PIN codes by postal circle: the first two or three digits identify the state (one circle can serve a
// union territory too). Where a prefix is shared by two states or territories, both are listed and the screen asks the
// person to choose; nothing is guessed. Longer keys override shorter ones (longest prefix wins).
//
// District and city need the full India Post directory ("All India Pincode Directory", data.gov.in). When that CSV is
// available, run:  node scripts/build-pin-prefixes.mjs --directory path/to/pincode.csv
// It adds a district per six-digit PIN (columns pincode, district/districtname, statename) to public/data/pin-districts.json
// and marks the prefix table so screens load it. Without it the inputs fill the state only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const range = (from, to, codes) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, n) => [String(from + n), codes]));

export const PIN_PREFIXES = {
  // 1: Delhi, Haryana, Punjab, Chandigarh, Himachal Pradesh, Jammu and Kashmir, Ladakh
  "11": ["07"], ...range(12, 13, ["06"]), ...range(14, 15, ["03"]), "16": ["03", "04"], "160": ["04", "03"], "17": ["02"], ...range(18, 19, ["01"]), "194": ["38", "01"],
  // 2: Uttar Pradesh and Uttarakhand
  ...range(20, 28, ["09"]), "246": ["05"], "248": ["05"], "249": ["05"], "263": ["05"], "244": ["09", "05"], "247": ["09", "05"], "262": ["09", "05"],
  // 3: Rajasthan, Gujarat, Dadra and Nagar Haveli and Daman and Diu
  ...range(30, 34, ["08"]), ...range(36, 39, ["24"]), "362": ["24", "26"], "396": ["24", "26"],
  // 4: Maharashtra, Goa, Madhya Pradesh, Chhattisgarh
  ...range(40, 44, ["27"]), "403": ["30"], ...range(45, 48, ["23"]), "49": ["22"],
  // 5: Telangana, Andhra Pradesh, Karnataka
  "50": ["36"], ...range(51, 53, ["37"]), "53346": ["37", "34"], ...range(56, 59, ["29"]),
  // 6: Tamil Nadu, Puducherry, Kerala, Lakshadweep
  ...range(60, 64, ["33"]), "605": ["33", "34"], "607": ["33", "34"], "609": ["33", "34"], ...range(67, 69, ["32"]), "67331": ["32", "34"], "68255": ["31"],
  // 7: West Bengal, Sikkim, Andaman and Nicobar, Odisha, Assam and the north-east
  ...range(70, 74, ["19"]), "737": ["11"], "744": ["35"], ...range(75, 77, ["21"]), "78": ["18"],
  "790": ["12"], "791": ["12"], "792": ["12"], "793": ["17"], "794": ["17"], "795": ["14"], "796": ["15"], "797": ["13"], "798": ["13"], "799": ["16"],
  // 8: Bihar and Jharkhand
  ...range(80, 85, ["10"]), "814": ["20"], "815": ["20"], "816": ["20"], "822": ["20"], ...range(825, 829, ["20"]), "83": ["20"],
  // 9: Army Postal Service (no state)
  ...range(90, 99, [])
};

function readDirectory(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",").map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const pin = header.indexOf("pincode"), district = header.findIndex(h => h === "district" || h === "districtname");
  if (pin < 0 || district < 0) throw new Error("The directory CSV needs pincode and district columns.");
  const out = {};
  for (const line of lines) {
    const cells = line.split(",");
    const code = (cells[pin] ?? "").trim(), name = (cells[district] ?? "").trim();
    if (/^[1-9]\d{5}$/.test(code) && name && !out[code]) out[code] = name.replace(/\s+/g, " ").replace(/\b([a-z])/g, c => c.toUpperCase());
  }
  return out;
}

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--directory");
let districts = false;
if (dirIndex >= 0) {
  const data = readDirectory(resolve(args[dirIndex + 1]));
  writeFileSync(resolve(root, "public/data/pin-districts.json"), JSON.stringify({ source: "India Post All India Pincode Directory", districts: data }));
  districts = true;
}
mkdirSync(resolve(root, "public/data"), { recursive: true });
writeFileSync(resolve(root, "public/data/pin-prefixes.json"), JSON.stringify({
  version: 1,
  source: "India Post postal circles by PIN prefix (state level). Shared prefixes list every candidate; the person chooses.",
  districts,
  prefixes: PIN_PREFIXES
}) + "\n");
console.log(`Wrote public/data/pin-prefixes.json (${Object.keys(PIN_PREFIXES).length} prefixes)${districts ? " and pin-districts.json" : ""}.`);
