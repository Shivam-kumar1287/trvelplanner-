const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  bookings: {
    type: [
      {
        listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing" },
        checkIn: { type: Date },
        checkOut: { type: Date },
        guests: { type: Number, min: 1 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  },
});

// Hash password before saving
userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Password validation method
userSchema.methods.validatePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
