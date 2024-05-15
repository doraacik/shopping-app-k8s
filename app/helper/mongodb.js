const mongoose = require('mongoose');

const mongoUri = 'mongodb://dora:12345678@mongo-db-service:27017/shopping-app-db?directConnection=true&authSource=admin';

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 5000
});

module.exports = mongoose;