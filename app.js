const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const crypto = require("crypto");
require("dotenv").config();
require("dotenv").config();
app.use(express.static("images"));


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

const User = require("./models/user.js");
const Listing = require("./models/listing.js");
const wrapAsync = require("./utils/wrapAsync.js");
const ExpressError = require("./utils/ExpressError.js");

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));
app.use(
  session({
    secret: "secretkey123",
    resave: false,
    saveUninitialized: true,
  })
);

async function main() {
  await mongoose.connect("mongodb://127.0.0.1:27017/wanderlust");
}
main()
  .then(() => console.log(" MongoDB Connected"))
  .catch((err) => console.log(err));

app.use(
  wrapAsync(async (req, res, next) => {
    res.locals.user = null;
    if (req.session.user_id) {
      try {
        const user = await User.findById(req.session.user_id).select("-password");
        res.locals.user = user;
      } catch (err) {
        res.locals.user = null;
      }
    }
    next();
  })
);

const requireLogin = (req, res, next) => {
  if (!req.session.user_id) {
    return res.redirect("/login");
  }
  next();
};

app.get("/", (req, res) => {
  res.render("home");
});


app.get(
  "/listings",
  requireLogin,
  wrapAsync(async (req, res) => {
    const { q } = req.query;

    let filter = {};
    if (q && q.trim() !== "") {
      const searchRegex = new RegExp(q.trim(), "i");
      filter = {
        $or: [
          { title: searchRegex },
          { location: searchRegex },
          { country: searchRegex },
          { description: searchRegex },
        ],
      };
    }

    const allistings = await Listing.find(filter);
    res.render("listings/index", { allistings, searchQuery: q || "" });
  })
);

app.get("/listings/new", requireLogin, (req, res) => {
  res.render("listings/new");
});

app.get("/listing/new", requireLogin, (req, res) => {
  res.render("listings/new");
});

app.post(
  "/listings",
  requireLogin,
  wrapAsync(async (req, res) => {
    if (!req.body.listing) throw new ExpressError(400, "Invalid form data");

    const listing = new Listing(req.body.listing);

    if (!listing.image || !listing.image.url) {
      listing.image = {
        url: "https://images.unsplash.com/photo-1469022563149-aa64dbd37dae?w=500",
      };
    }

    await listing.save();
    res.redirect(`/listings/${listing._id}`);
  })
);

app.get(
  "/listings/:id",
  requireLogin,
  wrapAsync(async (req, res) => {
    const listing = await Listing.findById(req.params.id).populate("reviews.user", "email");
    if (!listing) throw new ExpressError(404, "Listing not found");
    const bookingSuccess = req.query.booked ? "Booking request submitted!" : null;
    res.render("listings/show", { listings: listing, bookingSuccess });
  })
);

app.post(
  "/listings/:id/reviews",
  requireLogin,
  wrapAsync(async (req, res) => {
    const listing = await Listing.findById(req.params.id);
    if (!listing) throw new ExpressError(404, "Listing not found");

    const { rating, comment } = req.body;
    if (!comment || !comment.trim()) {
      throw new ExpressError(400, "Comment is required");
    }

    const numericRating = Number(rating);
    const safeRating = Math.min(5, Math.max(1, isNaN(numericRating) ? 1 : numericRating));

    listing.reviews.push({
      user: req.session.user_id,
      comment: comment.trim(),
      rating: safeRating,
    });

    await listing.save();
    res.redirect(`/listings/${listing._id}`);
  })
);

app.put(
  "/listings/:id/reviews/:reviewId",
  requireLogin,
  wrapAsync(async (req, res) => {
    const { id, reviewId } = req.params;
    const { rating, comment } = req.body;

    const listing = await Listing.findById(id);
    if (!listing) throw new ExpressError(404, "Listing not found");

    const review = listing.reviews.id(reviewId);
    if (!review) throw new ExpressError(404, "Review not found");

    if (String(review.user) !== String(req.session.user_id)) {
      throw new ExpressError(403, "You cannot edit this review");
    }

    const numericRating = Number(rating);
    if (!isNaN(numericRating)) {
      review.rating = Math.min(5, Math.max(1, numericRating));
    }
    if (comment && comment.trim()) {
      review.comment = comment.trim();
    }

    await listing.save();
    res.redirect(`/listings/${listing._id}`);
  })
);

app.delete(
  "/listings/:id/reviews/:reviewId",
  requireLogin,
  wrapAsync(async (req, res) => {
    const { id, reviewId } = req.params;

    const listing = await Listing.findById(id);
    if (!listing) throw new ExpressError(404, "Listing not found");

    const review = listing.reviews.id(reviewId);
    if (!review) throw new ExpressError(404, "Review not found");

    if (String(review.user) !== String(req.session.user_id)) {
      throw new ExpressError(403, "You cannot delete this review");
    }

    review.remove();
    await listing.save();
    res.redirect(`/listings/${listing._id}`);
  })
);

app.post(
  "/listings/:id/reviews/:reviewId/like",
  requireLogin,
  wrapAsync(async (req, res) => {
    const { id, reviewId } = req.params;

    const listing = await Listing.findById(id);
    if (!listing) throw new ExpressError(404, "Listing not found");

    const review = listing.reviews.id(reviewId);
    if (!review) throw new ExpressError(404, "Review not found");

    review.likes = (review.likes || 0) + 1;
    await listing.save();

    res.redirect(`/listings/${listing._id}`);
  })
);

app.post(
  "/listings/:id/book",
  requireLogin,
  wrapAsync(async (req, res) => {
    const { checkIn, checkOut, guests } = req.body;
    const listing = await Listing.findById(req.params.id);
    if (!listing) throw new ExpressError(404, "Listing not found");

    console.log("Booking request", {
      listing: listing._id.toString(),
      user: req.session.user_id,
      checkIn,
      checkOut,
      guests,
    });

    const user = await User.findById(req.session.user_id);
    if (user) {
      if (!Array.isArray(user.bookings)) {
        user.bookings = [];
      }

      user.bookings.push({
        listing: listing._id,
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut ? new Date(checkOut) : undefined,
        guests: guests ? Number(guests) : undefined,
      });

      await user.save();
    }

    res.redirect(`/listings/${listing._id}?booked=1`);
  })
);

app.post(
  "/payments/create-order",
  requireLogin,
  wrapAsync(async (req, res) => {
    const { listingId, checkIn, checkOut, guests } = req.body;

    if (!listingId) {
      return res.status(400).json({ success: false, message: "Listing is required" });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    let nights = 1;
    if (checkIn && checkOut) {
      const start = new Date(checkIn);
      const end = new Date(checkOut);
      const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (!isNaN(diff) && diff > 0) {
        nights = diff;
      }
    }

    const amount = Math.max(1, listing.price * nights) * 100;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `order_${Date.now()}`,
      notes: {
        listingId: listing._id.toString(),
        userId: req.session.user_id.toString(),
        checkIn: checkIn || "",
        checkOut: checkOut || "",
        guests: guests ? String(guests) : "",
      },
    });

    const user = await User.findById(req.session.user_id).select("email");

    res.json({
      success: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      listingTitle: listing.title,
      listingId: listing._id,
      email: user ? user.email : "",
      checkIn,
      checkOut,
      guests,
    });
  })
);

app.post(
  "/payments/verify",
  requireLogin,
  wrapAsync(async (req, res) => {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      listingId,
      checkIn,
      checkOut,
      guests,
    } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment details received" });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    const user = await User.findById(req.session.user_id);
    if (user) {
      if (!Array.isArray(user.bookings)) {
        user.bookings = [];
      }

      user.bookings.push({
        listing: listing._id,
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut ? new Date(checkOut) : undefined,
        guests: guests ? Number(guests) : undefined,
      });

      await user.save();
    }

    res.json({ success: true });
  })
);

app.get(
  "/listings/:id/edit",
  requireLogin,
  wrapAsync(async (req, res) => {
    const listing = await Listing.findById(req.params.id);
    if (!listing) throw new ExpressError(404, "Listing not found");
    res.render("listings/edit", { listings: listing });
  })
);

app.put(
  "/listings/:id",
  requireLogin,
  wrapAsync(async (req, res) => {
    await Listing.findByIdAndUpdate(req.params.id, req.body.listing);
    res.redirect(`/listings/${req.params.id}`);
  })
);

app.delete(
  "/listings/:id",
  requireLogin,
  wrapAsync(async (req, res) => {
    await Listing.findByIdAndDelete(req.params.id);
    res.redirect("/listings");
  })
);


app.get("/signup", (req, res) => {
  res.render("auth/signup");
});

function createTransporter() {
  const { EMAIL_USER, EMAIL_PASS } = process.env;

  if (EMAIL_USER && EMAIL_PASS) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });

    transporter.verify((err, success) => {
      if (err) {
        console.error(" Email transporter connection failed:", err.message);
      } else {
        console.log(" Email transporter ready to send messages");
      }
    });

    return transporter;
  }

  console.warn("  EMAIL_USER or EMAIL_PASS not found — using mock transporter.");
  return {
    sendMail: async (options) => {
      console.log("Mock email (not sent):", JSON.stringify(options, null, 2));
      return { accepted: [options.to] };
    },
  };
}
const transporter = createTransporter();

const signupOtpStore = {};

async function safeSendMail(mailOptions, label = "Email") {
  try {
    await transporter.sendMail(mailOptions);
    console.log(` ${label} sent to ${mailOptions.to}`);
  } catch (err) {
    console.error(` Failed to send ${label}:`, err.message);
  }
}

app.post(
  "/signup",
  wrapAsync(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !email.includes("@")) {
      console.error(" Invalid or missing email in signup request:", email);
      return res.render("auth/signup", {
        error: "Please enter a valid email address.",
      });
    }

    const existing = await User.findOne({ email });
    if (existing)
      return res.render("auth/signup", { error: "Email already exists" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    signupOtpStore[email] = { otp, password, expires: Date.now() + 600000 };

    console.log(` Sending signup OTP to: ${email}`);

    await safeSendMail(
      {
        from: process.env.EMAIL_USER || "mock@local.dev",
        to: email,
        subject: "Signup OTP - Wanderlust",
        text: `Your verification OTP is: ${otp}. It expires in 10 minutes.`,
      },
      "Signup OTP"
    );

    res.render("auth/signup-verify", { email });
  })
);

app.post(
  "/signup/verify",
  wrapAsync(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !signupOtpStore[email]) {
      console.error(" OTP verify attempted with missing/invalid email:", email);
      return res.render("auth/signup", {
        error: "Invalid or expired signup session. Please register again.",
      });
    }

    const record = signupOtpStore[email];
    if (record.otp !== otp)
      return res.render("auth/signup-verify", {
        email,
        error: "Invalid OTP",
      });

    const user = new User({ email, password: record.password });
    await user.save();

    delete signupOtpStore[email];
    req.session.user_id = user._id;
    res.redirect("/listings");
  })
);

app.get("/login", (req, res) => res.render("auth/login"));

app.post(
  "/login",
  wrapAsync(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.render("auth/login", { error: "Invalid Email or Password" });

    const valid = await user.validatePassword(password);
    if (!valid)
      return res.render("auth/login", { error: "Invalid Email or Password" });

    req.session.user_id = user._id;
    res.redirect("/listings");
  })
);

app.post("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

const otpStore = {};

app.get("/forgot", (req, res) => {
  res.render("auth/forgot");
});

app.post(
  "/forgot",
  wrapAsync(async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user)
      return res.render("auth/forgot", { error: "Email not registered" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email] = otp;

    await safeSendMail(
      {
        from: process.env.EMAIL_USER || "mock@local.dev",
        to: email,
        subject: "Password Reset OTP - Wanderlust",
        text: `Your password reset OTP is: ${otp}. It expires in 10 minutes.`,
      },
      "Password Reset OTP"
    );

    res.render("auth/otp", { email });
  })
);

app.post(
  "/otp",
  wrapAsync(async (req, res) => {
    const { email, otp, password } = req.body;

    if (otpStore[email] !== otp) {
      return res.render("auth/otp", { email, error: "Invalid OTP" });
    }

    const user = await User.findOne({ email });
    user.password = password;
    await user.save();

    delete otpStore[email];
    res.redirect("/login");
  })
);

app.get(
  "/profile",
  requireLogin,
  wrapAsync(async (req, res) => {
    const user = await User.findById(req.session.user_id)
      .select("-password")
      .populate("bookings.listing");

    res.render("auth/profile", { user });
  })
);


app.all("*", (req, res, next) => {
  next(new ExpressError(404, "Page Not Found"));
});

app.use((err, req, res, next) => {
  const { status = 500, message = "Something went wrong!" } = err;
  res.status(status).render("error", { err });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` Server running at http://localhost:${PORT}`);
  console.log("DEBUG ENV CHECK:", process.env.RAZORPAY_KEY_ID);
  console.log("DEBUG ENV CHECK:", process.env.RAZORPAY_KEY_SECRET);
});

console.log("DEBUG ENV CHECK:");
console.log("RAZORPAY_KEY_ID =", process.env.RAZORPAY_KEY_ID);
console.log("RAZORPAY_KEY_SECRET =", process.env.RAZORPAY_KEY_SECRET ? "LOADED" : "NOT LOADED");
