// Utility helpers.

// PLANTED: eval() on user-controlled input. Should be CONFIRMED (high).
function computeExpression(userInput) {
  // Danger: executes arbitrary code from the request.
  return eval(userInput);
}

function slugify(text) {
  return String(text).toLowerCase().trim().replace(/\s+/g, "-");
}

module.exports = { computeExpression, slugify };
