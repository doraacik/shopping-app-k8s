const mongodbConnection = require('./helper/mongodb.js');
const pool = require("./helper/mysql");
const express = require("express");
const session = require('express-session');
const redis = require("redis");
const connectRedis = require("connect-redis");
const bodyParser = require('body-parser');
const amqp = require('amqplib');
require("dotenv").config();
const { hashSync, genSaltSync, compareSync } = require("bcryptjs");

const app = express();
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json())

const rabbitmqHost = 'rabbitmq';
const rabbitmqUrl = "amqp://rabbitmq:5672";

const REDIS_PORT = process.env.REDIS_PORT;
const PORT = process.env.APP_PORT;

let cartTotal = 0;

mongodbConnection.connection.once('open', () => {
    console.log('MongoDB connected successfully!!');
});

mongodbConnection.connection.on('error', (err) => {
});

pool.getConnection((err, connection) => {
    if (err) {
        console.log("Database connection error: ", err);
    } else {
        console.log("Database connected :))))");
    }
});

async function start() {
    try {
        await connectToRabbitMQ();
    } catch (error) {
        console.error('Error starting Provider App:', error);
    }
}

async function connectToRabbitMQ() {
    try {
        const connection = await amqp.connect(`amqp://${rabbitmqHost}`);
        const channel = await connection.createChannel();
        await channel.assertQueue('cart_queue', { durable: true });
        console.log('Connected to RabbitMQ');
    } catch (error) {
        console.error('Error connecting to RabbitMQ:', error);
        throw error;
    }
}

start();

const redisClient = redis.createClient({
    host: 'redis-service',
    port: REDIS_PORT
})

const redisStore = connectRedis(session);

redisClient.on('error', function (err) {
    console.log('Could not establish a connection with redis. ' + err);
});

redisClient.on('connect', function (err) {
    console.log('Connected to redis successfully');
});

app.use(session({
    store: new redisStore({ client: redisClient }),
    name: 'ShoppingAppSession',
    secret: 'secret$%^134',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // if true only transmit cookie over https
        httpOnly: false, // if true prevent client side JS from reading the cookie 
        maxAge: 1000 * 60 * 10 // session max age in miliseconds
    }
}))

const redirectLogin = (req, res, next) => {
    if (!req.session.email) {
        res.redirect('/login')
    } else {
        next()
    }
}

const redirectHome = (req, res, next) => {
    if (req.session.email) {
        res.redirect('/home')
    } else {
        next()
    }
}

app.get('/', (req, res) => {
    const { email } = req.session
    console.log(email);
    res.send(`
    <h1> Welcome!</h1>
     ${email ? `<a href = '/home'> Home </a>
    <form method='post' action='/logout'>
    <button>Logout</button>
    </form>` : `<a href = '/login'> Login </a>
   <a href = '/register'> Register </a>
`}
    `)
})

app.get('/home', redirectLogin, async (req, res) => {
    const { email } = req.session
    console.log(email);
    if (email) {
        try {
            redisClient.hgetall(email, function (err, obj) {

                console.log(obj)
                //req.user = obj;
                res.send(`
        <h1>Home</h1>
        <a href='/'>Main</a>
        <ul>
        <li> Name: ${obj.name} </li>
        <li> Email:${obj.email} </li>
        </ul>
      
        `)
            })
        } catch (e) {
            console.log(e);
            res.sendStatus(404);
        }
    }
})

app.get('/login', redirectHome, (req, res) => {
    res.send(`
    <h1>Login</h1>
    <form method='post' action='/login'>
    <input type='email' name='email' placeholder='Email' required />
    <input type='password' name='password' placeholder='password' required/>
    <input type='submit' />
    </form>
    <a href='/register'>Register</a>
    `)
})

app.get('/register', redirectHome, (req, res) => {
    res.send(`
    <h1>Register</h1>
    <form method='post' action='/Register'>
    <input type='text' name='name' placeholder='First Name' required />
    <input type='text' name='surname' placeholder='Last Name' required />
    <input type='email' name='email' placeholder='Email' required />
    <input type='password' name='password' placeholder='password' required/>
    <input type='submit' />
    </form>
    <a href='/login'>Login</a>
    `)
});

app.post('/login', redirectHome, (req, res, next) => {
    try {
        const email = req.body.email;
        const password = req.body.password;

        console.log("Attempting login with email:", email);

        redisClient.hgetall(email, async function (err, obj) {
            if (!obj) {
                // If user info is not found in Redis, fetch from MySQL
                console.log("User not found in Redis, attempting MySQL lookup");

                const query = `SELECT * FROM users WHERE email = ?`;
                pool.query(query, [email], async (error, results, fields) => {
                    if (error) {
                        console.error('Error fetching user from MySQL:', error);
                        return res.status(500).send({ message: "Internal Server Error" });
                    }
                    if (results.length === 0) {
                        console.log("User not found in MySQL either");
                        return res.status(401).send({ message: "Invalid email or password" });
                    }

                    const user = results[0];
                    const isValidPassword = compareSync(password, user.password);

                    if (!isValidPassword) {
                        console.log("Invalid password");
                        return res.status(401).send({ message: "Invalid email or password" });
                    }
                    // Store user info in Redis for future logins
                    redisClient.hmset(email, user, (err) => {
                        if (err) {
                            console.error('Error storing user in Redis:', err);
                        }
                        console.log("User info stored in Redis");
                    });

                    req.session.email = user.email;
                    return res.redirect('/home');
                });
            } else {
                // User info found in Redis, proceed with login
                console.log("User found in Redis, attempting login");

                const isValidPassword = compareSync(password, obj.password);

                if (!isValidPassword) {
                    console.log("Invalid password");
                    return res.status(401).send({ message: "Invalid email or password" });
                }

                req.session.email = obj.email;
                return res.redirect('/home');
            }
        });
    } catch (e) {
        console.error('Error during login:', e);
        return res.status(500).send({ message: "Internal Server Error" });
    }
});

app.post('/register', redirectHome, (req, res, next) => {
    try {
        const name = req.body.name;
        const surname = req.body.surname;
        const email = req.body.email;
        let password = req.body.password;


        if (!name || !surname || !email || !password) {
            return res.sendStatus(400);
        }

        const salt = genSaltSync(10);
        password = hashSync(password, salt);


        const values = [name, surname, email, password];

        pool.query('INSERT INTO users (name, surname, email, password) VALUES (?, ?, ?, ?)', values, (mysqlErr, mysqlResult, fields) => {
            if (mysqlErr) {
                console.error('Error registering user:', mysqlErr);
                return res.sendStatus(400);
            }
            console.log('User registered:', mysqlResult.insertId);
            res.redirect('/register');
        });
    } catch (error) {
        console.error('Error registering user:', error);
        res.sendStatus(400);
    }
});

app.post('/logout', redirectLogin, (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/home')
        }

        res.clearCookie(process.env.SESS_NAME)
        res.redirect('/login')
    })
});

app.post('/add-cart', (req, res) => {
    // Assuming you have imported and initialized the Redis client (conn)
    const session = req.session.id; // Assuming you are using sessions to track users
    const item = req.body.item; // Assuming you receive the item and count in the request body
    const count = req.body.count || 1; // Default count to 1 if not provided

    if (!session || !item) {
        return res.status(400).send('Missing session ID or item in the request.');
    }

    redisClient.hget('cart:' + session, item, (err, existingCount) => {
        if (err) {
            console.error('Error fetching item count from cart:', err);
            return res.status(500).send('Error fetching item count from cart.');
        }

        const newCount = parseInt(existingCount || 0) + parseInt(count);

        // Update the count of the item in the cart
        redisClient.hset('cart:' + session, item, newCount, (err, reply) => {
            if (err) {
                console.error('Error updating item count in cart:', err);
                return res.status(500).send('Error updating item count in cart.');
            } else {
                console.log('Item added to cart with count:', item, newCount);
                printCart(session, res);
                //return res.status(200).send('Item added to cart.');
            }
        });
    });
});

app.post('/buy', (req, res) => {
    // Assuming you have imported and initialized the Redis client (conn)
    const session = req.session.id; // Assuming you are using sessions to track users
    const { email } = req.session;
    let user_id = 0;

    if (!session) {
        return res.status(400).send('Missing session ID in the request.');
    }

    redisClient.hgetall('cart:' + session, (err, cart) => {
        if (err) {
            console.error('Error fetching item count from cart:', err);
            return res.status(500).send('Error fetching item count from cart.');
        }

        let quantity = 0;
        for (const item in cart) {
            quantity += parseInt(cart[item]);
        }

        console.log("This is quantity: " + quantity);

        fetchUserId(email, (err, user_id) => {
            if (err) {
                console.error('Error:', err);
                return res.status(500).send('Error fetching user ID.');
            }

            console.log('User ID:', user_id);

            const order_date = new Date().toISOString().slice(0, 19).replace('T', ' '); // Get current datetime in MySQL format

            try {
                pool.query("INSERT INTO orders (user_id, quantity, total_price, order_date) VALUES (?,?,?,?)", [user_id, quantity, cartTotal, order_date], (error, results) => {
                    if (error) {
                        console.error("Database query error:", error);
                        return res.status(500).send('Error inserting order.');
                    } else {
                        console.log("Data inserted into orders table successfully:", results);

                        const order_id = results.insertId; // Get the auto-generated order ID

                        console.log("Order inserted successfully. Order ID:", order_id);

                        for (const item in cart) {
                            // Assuming you have product_id associated with each item in cart
                            fetchProductId(item, (err, product_id) => {
                                if (err) {
                                    console.error('Error:', err);
                                    return res.status(500).send('Error fetching product ID.');
                                }

                                console.log("itemın product_id'si carttan : " + product_id)
                                //orderDetailsValues.push([order_id, product_id, parseInt(cart[item])]);

                                pool.query("INSERT INTO order_details (order_id, product_id, quantity) VALUES (?,?,?)", [order_id, product_id, parseInt(cart[item])], (error, details_results) => {
                                    if (error) {
                                        console.error("Error inserting order details:", error);
                                        return res.status(500).send('Error inserting order.');
                                    }
                                    console.log("Order details inserted successfully:", details_results);
                                    triggerRabbitMQ(product_id, parseInt(cart[item]));
                                });
                            });

                        }
                        let html = '<h1>Ordered successfully!</h1><ul>';
                        res.status(200).send(html);
                    }
                });
            } catch (error) {
                console.error('Error handling message:', error);
                return res.status(500).send('Error handling request.');
            }
        });
    });
});
const Comment = mongodbConnection.model('comment', { product_id: Number, text: String, product_rate: Number  });

app.get('/comment/:product_name/:comment/:rate', async (req, res) => {

    try {
        const { product_name, comment, rate } = req.params;
        const product_rate = parseInt(rate);

        fetchProductId(product_name, (err, product_id) => {
            if (err) {
                console.error('Error:', err);
                return res.status(500).send('Error fetching product ID.');
            }

            //const Comment = mongodbConnection.model('comment', { product_id: Number, text: String, product_rate: Number });
            const newComment = new Comment({ product_id, text: comment, product_rate });

            newComment.save()
                .then(mongoResult => {
                    res.status(201).json({ message: 'Comment and rate created successfully', product_id, commentId: mongoResult._id, product_rate });
                })
                .catch(mongoErr => {
                    console.error('Error inserting comment into MongoDB:', mongoErr);
                    res.status(500).json({ error: 'Error creating comment' });
                });
        });
    } catch (error) {
        console.error('Error in route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/see-comments/:product_name', async (req, res) => {
    const { product_name } = req.params;
    fetchProductId(product_name, async (err, product_id) => {
        if (err) {
            console.error('Error:', err);
            return res.status(500).send('Error fetching product ID.');
        }
    //const Comment = mongodbConnection.model('comment', { product_id: Number, text: String, product_rate: Number  });
    try {
        // Await the result of Comment.find()
        const mongoResult = await Comment.find({ product_id: product_id });

        const productWithComments = { product_id: product_id, comments: mongoResult };

        res.json(productWithComments);
    } catch (mongoErr) {
        console.error('Error fetching comments from MongoDB:', mongoErr);
        res.status(500).json({ error: 'Error fetching comments' });
    }
    });
});

function printCart(session, res) {
    redisClient.hgetall('cart:' + session, function (err, cart) {
        if (err) {
            console.error('Error fetching cart information:', err);
            res.status(500).send('Error fetching cart information.');
            return;
        }
        console.log('Cart contents:', cart);
        let productCount = 0;
        let cart_total = 0;
        // Render the cart in HTML
        let html = '<h1>Cart Contents</h1><ul>';

        // Array to store promises for all the queries
        const queryPromises = [];

        for (const item in cart) {
            productCount += parseInt(cart[item]);

            const queryPromise = new Promise((resolve, reject) => {
                pool.query(`SELECT price FROM products WHERE product_name = ?`, [item], (error, results, fields) => {
                    if (error) {
                        console.error('Error fetching product from MySQL:', error);
                        reject(error);
                        return;
                    }
                    if (results.length === 0) {
                        console.log("Product not found in MySQL:", item);
                        reject(new Error("Product not found in MySQL: " + item));
                        return;
                    }
                    const product_price = results[0].price;
                    const item_total_price = parseInt(cart[item]) * product_price;
                    cart_total += item_total_price;
                    html += '<li>' + item + ': ' + cart[item] + ' total price: ' + item_total_price + '</li>';
                    resolve();
                });
            });
            queryPromises.push(queryPromise);
        }
        // Wait for all query promises to resolve
        Promise.all(queryPromises)
            .then(() => {
                cartTotal = cart_total;
                html += '<li>' + 'Cart total: ' + cart_total + '</li>';
                html += '</ul>';
                res.status(200).send(html);
            })
            .catch((error) => {
                console.error('Error processing cart:', error);
                res.status(500).send('Error processing cart.');
            });
    });
}

async function triggerRabbitMQ(product_id, product_quantity) {
    try {
        const connection = await amqp.connect(rabbitmqUrl, 'heartbeat=60');
        const channel = await connection.createChannel();

        const requestData = { product_id, product_quantity };
        const message = JSON.stringify(requestData);
        await channel.sendToQueue('cart_queue', Buffer.from(message));
        console.log('Message sent to RabbitMQ:', message);

        await channel.close();
        await connection.close();

    } catch (error) {
        console.error('Error sending message to RabbitMQ:', error);
        throw error;
    }
}

function fetchUserId(email, callback) {
    pool.query('SELECT user_id FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
            console.error('Error fetching user_id:', err);
            return callback(err, null);
        }
        if (results.length === 0) {
            return callback(null, null); // User not found
        }
        const user_id = results[0].user_id;
        return callback(null, user_id);
    });
}

function fetchProductId(product_name, callback) {
    pool.query('SELECT product_id FROM products WHERE product_name = ?', [product_name], (err, results) => {
        if (err) {
            console.error('Error fetching user_id:', err);
            return callback(err, null);
        }
        if (results.length === 0) {
            return callback(null, null); // User not found
        }
        const product_id = results[0].product_id;
        return callback(null, product_id);
    });
}

app.listen(PORT, () => { console.log(`server is listening on ${PORT}`) });