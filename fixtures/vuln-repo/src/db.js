// Data access layer. NOTE: intentionally vulnerable for testing.
const db = {
  query(sql, cb) {
    // pretend this talks to a real database
    return cb(null, []);
  },
};

// PLANTED: SQL injection via unsanitized template literal.
function getUserById(req, res) {
  const id = req.params.id;
  db.query(`SELECT * FROM users WHERE id = ${id}`, (err, rows) => {
    if (err) return res.status(500).send("error");
    res.json(rows);
  });
}

module.exports = { getUserById };
