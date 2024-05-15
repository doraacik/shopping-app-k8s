const mysql = require("mysql2");


const connection = mysql.createPool({
  connectionLimit: 100,
  host: "mysql-service",
  user: "root",
  password: "12345678",
  database: "shopping-app-db",
});

module.exports = connection;