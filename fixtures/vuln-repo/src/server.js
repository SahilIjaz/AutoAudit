const express = require("express");
const { getUserById } = require("./db");
const { computeExpression } = require("./utils");

const app = express();

app.get("/users/:id", getUserById);

app.get("/compute", (req, res) => {
  res.send(String(computeExpression(req.query.expr)));
});

app.listen(3000);
