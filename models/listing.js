const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  comment: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  likes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const listingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  image: {
    url: {
      type: String,
      default: "https://images.unsplash.com/photo-1469022563149-aa64dbd37dae?w=500",
    },
  },
  price: { type: Number, required: true, min: 0 },
  location: { type: String, required: true },
  country: { type: String, required: true },
  reviews: [reviewSchema],
});

module.exports = mongoose.model("Listing", listingSchema);
