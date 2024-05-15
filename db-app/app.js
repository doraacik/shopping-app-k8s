const express = require("express");
const mysql = require("mysql2");
const amqp = require('amqplib');
const bodyParser = require('body-parser'); //express could not handle it so I used body-parser.
const app = express();
require("dotenv").config();

app.use(bodyParser.urlencoded({ extended: true }));
const rabbitmqHost = 'rabbitmq';
const rabbitmqUrl = "amqp://rabbitmq:5672";

const port = 4002;

app.use(express.json());

const pool = mysql.createPool({
    connectionLimit: 100,
    host: "mysql-service",
    user: "root",
    password: "12345678",
    database: "shopping-app-db",
  });

  app.get("/", (req, res) => {
    res.send("Hi this is Db app!!");
});


pool.getConnection((err, connection) => {
    if (err) {
      console.log("Database connection error: ", err);
    } else {
      console.log("Database connected");
    }
});

async function start() {
    try {
        await connectToRabbitMQ();
        app.listen(port, () => {
            console.log(`DB-app listening at http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Error starting DB App:', error);
        // Exit the process or handle the error accordingly
        process.exit(1);
    }
}

async function connectToRabbitMQ() {
    try {
        const connection = await amqp.connect(rabbitmqUrl,'heartbeat=60');
        const channel = await connection.createChannel();
        await channel.assertQueue('cart_queue', { durable: true });
        console.log('Connected to RabbitMQ');

        // Start consuming messages from the queue
        channel.consume('cart_queue', (message) => {
            const data = JSON.parse(message.content.toString());
            console.log(data);
            handleMessage(data);
            channel.ack(message); // Acknowledge message receipt
        });
    } catch (error) {
        console.error('Error connecting to RabbitMQ:', error);
        throw error;
    }
}

async function handleMessage(data) {
    console.log('Received message from RabbitMQ:', data);
    const { product_id, product_quantity } = data;

    try {
            //const insertQuery = `INSERT INTO texts (text) VALUES (?)`; // Use "?" as placeholder
            //const [rows, fields] = await client.query(insertQuery, [text]);
            pool.query("UPDATE products SET stock = stock - ? WHERE product_id = ?", [product_quantity, product_id], (error, results) => {
                if (error) {
                    console.error("Database query error:", error);
                } else {
                    console.log("Data inserted successfully:", results);
                }
            });
    } catch (error) {
        console.error('Error handling message:', error);
    }
}



start();
