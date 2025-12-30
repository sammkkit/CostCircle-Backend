import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

// REPLACE '1' WITH YOUR ACTUAL USER ID FROM DATABASE
const payload = { id: 3 }; 

const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

console.log("\nCopy this into Postman Auth:");
console.log(token);
console.log("\n");