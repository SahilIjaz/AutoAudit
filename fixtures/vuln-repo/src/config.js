// Application configuration.

// PLANTED (real): a hardcoded live-looking secret. Should be CONFIRMED.
const STRIPE_KEY = "sk_live_51H8xQ2eZvKYlo2CqFakeKeyForTestingOnly00abcd";

// DECOY: an obvious placeholder. A grounded agent should mark this a
// FALSE POSITIVE after reading the file — it's not a real secret.
const config = {
  apiKey: "YOUR_API_KEY_HERE",
  stripeKey: STRIPE_KEY,
  port: process.env.PORT || 3000,
};

module.exports = config;
