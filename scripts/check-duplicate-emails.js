/**
 * Read-only: check for duplicate emails among WEB-ACCOUNT refs in Monitor.
 * Also checks phone number formats to identify potential Shopify issues.
 */
import "dotenv/config";

const MONITOR_URL = process.env.MONITOR_URL;
const MONITOR_USER = process.env.MONITOR_USER;
const MONITOR_PASS = process.env.MONITOR_PASS;
const MONITOR_COMPANY = process.env.MONITOR_COMPANY;

async function monitorLogin() {
  const res = await fetch(`${MONITOR_URL}/${MONITOR_COMPANY}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Username: MONITOR_USER, Password: MONITOR_PASS, ForceRelogin: true }),
  });
  const sessionId = res.headers.get("x-monitor-sessionid");
  if (!sessionId) throw new Error("Login failed");
  return sessionId;
}

async function main() {
  console.log("=== Duplicate Email & Phone Format Check (read-only) ===\n");

  let sessionId = await monitorLogin();
  const all = [];
  let skip = 0;

  while (true) {
    const url = `${MONITOR_URL}/${MONITOR_COMPANY}/api/v1/Sales/Customers?$top=100&$skip=${skip}&$expand=References`;
    let res = await fetch(url, {
      headers: { Accept: "application/json", "X-Monitor-SessionId": sessionId },
    });
    if (!res.ok) {
      sessionId = await monitorLogin();
      res = await fetch(url, {
        headers: { Accept: "application/json", "X-Monitor-SessionId": sessionId },
      });
      if (!res.ok) break;
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    skip += 100;
    process.stdout.write(`  Fetched ${all.length} customers...\r`);
  }
  console.log(`  Fetched ${all.length} customers    \n`);

  // Extract WEB-ACCOUNT refs
  const emailMap = new Map();
  const phones = [];

  for (const c of all) {
    if (c.BlockedStatus === 2) continue;
    if (!c.References) continue;
    for (const ref of c.References) {
      if (!ref.Category?.includes("WEB-ACCOUNT")) continue;
      let email = ref.EmailAddress || "";
      const match = email.match(/<([^>]+)>/);
      if (match) email = match[1];
      email = email.trim().toLowerCase();
      if (!email) continue;

      if (!emailMap.has(email)) emailMap.set(email, []);
      emailMap.get(email).push({ code: c.Code, name: c.Name, refName: ref.Name || "" });

      const phone = ref.CellPhoneNumber || ref.PhoneNumber || "";
      if (phone) {
        phones.push({ code: c.Code, email, phone });
      }
    }
  }

  // 1. Duplicate emails
  const dupes = [...emailMap.entries()].filter(([_, refs]) => refs.length > 1);
  console.log("═══ DUBBLA E-POSTADRESSER ═══");
  console.log(`Totalt unika e-post: ${emailMap.size}`);
  console.log(`E-post med flera WEB-ACCOUNT-refs: ${dupes.length}\n`);

  // Write full CSV
  const { writeFileSync } = await import("fs");
  const csvLines = ["E-post;Antal refs;Typ;Kunder"];
  for (const [email, refs] of dupes) {
    const codes = refs.map((r) => r.code);
    const uniqueCodes = [...new Set(codes)];
    const typ = uniqueCodes.length === 1 ? "Samma kund" : "OLIKA kunder";
    const detail = refs.map((r) => `${r.code} ${r.name} (${r.refName.trim()})`).join(" | ");
    csvLines.push(`${email};${refs.length};${typ};${detail}`);
  }
  writeFileSync("scripts/duplicate-emails-monitor.csv", csvLines.join("\n") + "\n");
  console.log(`  Wrote all ${dupes.length} to scripts/duplicate-emails-monitor.csv\n`);

  if (dupes.length > 0) {
    for (const [email, refs] of dupes.slice(0, 10)) {
      const isSameCustomer = refs.every((r) => r.code === refs[0].code);
      const tag = isSameCustomer ? "(samma kund)" : "(OLIKA kunder!)";
      console.log(`  ${email} — ${refs.length} refs ${tag}`);
      for (const r of refs) {
        console.log(`    ${r.code} ${r.name} (${r.refName})`);
      }
    }
    if (dupes.length > 10) console.log(`  ... se CSV för resten`);
  }

  // 2. Phone format issues
  console.log("\n═══ TELEFONNUMMER-FORMAT ═══");
  const badPhones = phones.filter((p) => {
    // Shopify wants E.164-ish or at least digits with optional +
    // Flag anything with letters, double spaces, or clearly wrong format
    return /[a-zA-Z]/.test(p.phone) || p.phone.length < 6 || p.phone.length > 20;
  });
  console.log(`Totalt med telefonnr: ${phones.length}`);
  console.log(`Potentiellt problematiska: ${badPhones.length}\n`);
  if (badPhones.length > 0) {
    for (const bp of badPhones.slice(0, 20)) {
      console.log(`  ${bp.code} ${bp.email} — "${bp.phone}"`);
    }
    if (badPhones.length > 20) console.log(`  ... och ${badPhones.length - 20} fler`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
