import { randomBytes, createHash } from "node:crypto";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const purchaseReference = process.argv[2]?.trim() || null;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your local shell first.");
  process.exitCode = 1;
} else {
  const randomPart = randomBytes(16).toString("hex").toUpperCase();
  const groups = randomPart.match(/.{1,4}/g);
  const code = `SELA-PLUS-${groups.join("-")}`;
  const codeHash = createHash("sha256").update(code).digest("hex");

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/sela_license_codes`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        code_hash: codeHash,
        purchase_reference: purchaseReference,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase rejected code creation (HTTP ${response.status}): ${errorText}`);
    }

    console.log("New Sela Plus Lifetime code (shown only once):");
    console.log(code);
    if (purchaseReference) console.log(`Purchase reference: ${purchaseReference}`);
    console.log("Send the code to the customer through your verified support channel.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not create the license code.");
    process.exitCode = 1;
  }
}
