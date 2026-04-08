import bcrypt from "bcrypt";
console.log(bcrypt.hashSync('admin123', 10))