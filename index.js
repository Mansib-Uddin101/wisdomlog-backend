const express = require('express');
const cors = require('cors');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

require('dotenv').config();

const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
app.use(cors());

const port = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI;

// Initialize MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Cache the connection promise for Serverless environments
let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = client.connect().then(() => client.db("wisdomlog"));
  }
  return dbPromise;
}

// =========================================================================
// ⚠️ CRITICAL: WEBHOOK ROUTE (Must stay BEFORE express.json())
// =========================================================================
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`❌ Webhook signature validation failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;

    if (userId) {
      try {
        const database = await getDb(); // Added await here

        // Updates the single "user" collection matching your schema exactly
        const updateResult = await database.collection("user").updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isPremium: true } }
        );

        console.log(`📡 Stripe Webhook processed for User: ${userId}`);
        console.log(`📝 Matched: ${updateResult.matchedCount}, Modified: ${updateResult.modifiedCount}`);

        if (updateResult.modifiedCount > 0) {
          console.log(`⭐ User ${userId} successfully upgraded to Lifetime Premium!`);
        }
      } catch (dbError) {
        console.error("🚨 Failed to update database inside webhook:", dbError);
        return res.status(500).send("Internal Database Update Error");
      }
    }
  }

  res.status(200).json({ received: true });
});

// Global Middleware for standard routes
app.use(express.json());

// Initialize JWKS context
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

// Middleware: Verify JWT Token
const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Forbidden" });
  }
};

// =========================================================================
// 🌐 CORE API ROUTES (Ensure EVERY database call uses 'await getDb()')
// =========================================================================

app.get('/lessons', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection("lessons").find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

app.post('/lessons', verifyToken, async (req, res) => {
  try {
    const lessonData = req.body;
    const db = await getDb();
    const result = await db.collection("lessons").insertOne(lessonData);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error saving Lesson:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.delete('/lessons/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid or missing Lesson ID format."
      });
    }

    const query = { _id: new ObjectId(id) };
    const db = await getDb();
    const result = await db.collection("lessons").deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Lesson not found."
      });
    }

    res.status(200).send({
      success: true,
      message: "Lesson deleted successfully.",
      result
    });

  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).send({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
});

app.patch('/lessons/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    const db = await getDb();
    const result = await db.collection("lessons").updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update lesson." });
  }
});

app.get('/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const result = await db.collection("lessons").findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).send({ message: "lesson not found" });
    }
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Invalid ID format or server error" });
  }
});

app.post('/comments', verifyToken, async (req, res) => {
  try {
    const commentData = req.body;
    const db = await getDb();
    await db.collection("comments").insertOne(commentData);
    res.sendStatus(201);
  } catch (error) {
    res.status(500).send({ message: `Error: ${error}` });
  }
});

app.get('/comments', async (req, res) => {
  try {
    const { lessonId } = req.query;
    const db = await getDb();
    const result = await db.collection("comments").find({ lessonId }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: `Error: ${error}` });
  }
});

app.post('/favorites', verifyToken, async (req, res) => {
  try {
    const favoriteData = req.body;
    const db = await getDb();
    const result = await db.collection("favorites").insertOne(favoriteData);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error saving favorite:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.delete('/favorites/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const db = await getDb();
    const result = await db.collection("favorites").deleteOne({
      _id: new ObjectId(id)
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Favorite not found." });
    }

    res.status(200).send({ message: "Successfully removed from favorites.", result });
  } catch (error) {
    console.error("Error deleting favorite:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.get('/favorites',  async (req, res) => {
  try {
    const { userId } = req.query;
    const db = await getDb();
    const result = await db.collection("favorites").find({ userId: userId }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: `Error: ${error}` });
  }
});

app.get('/favorites/check', verifyToken, async (req, res) => {
  try {
    const { userId, lessonId } = req.query;
    if (!userId || !lessonId) {
      return res.status(400).send({ message: "Both userId and lessonId are required." });
    }

    const db = await getDb();
    const existingFavorite = await db.collection("favorites").findOne({ userId, lessonId });
    res.status(200).send({ isSaved: !!existingFavorite });
  } catch (error) {
    console.error("Error checking favorite status:", error);
    res.status(500).send({ message: `Error checking status: ${error.message}` });
  }
});

app.post('/lesson-reports', verifyToken, async (req, res) => {
  try {
    const report = req.body;
    const db = await getDb();
    const result = await db.collection("lessons-reports").insertOne(report);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error saving report:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.get('/users/', verifyToken, async (req, res) => {
   try {
    const db = await getDb();
    const result = await db.collection("user").find().toArray();
    res.status(200).send(result); // Changed status code from 201 to 200 for GET requests
  } catch (error) {
    console.error("Error getting users", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  } 
});

app.delete('/users/:id', verifyToken, async (req, res) => {
   try {
    const { id } = req.params;
    const db = await getDb();
    const result = await db.collection("user").deleteOne({_id: new ObjectId(id)})
    res.status(200).send(result); // Changed status code from 201 to 200
  } catch (error) {
    console.error("Error getting users", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  } 
});

app.patch('/users/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const db = await getDb();
    const result = await db.collection("user").updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    res.status(200).send(result);
  } catch (error) {
    console.error("Error updating user role", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.get('/users/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();

    // 🚨 Critical Fix: Fixed an issue in your original code where you referenced undefined variables ('user')
    let activeUser = await db.collection("user").findOne({ _id: new ObjectId(id) });

    if (!activeUser) {
      activeUser = await db.collection("users").findOne({ _id: new ObjectId(id) });
    }

    if (!activeUser) {
      return res.status(404).send({ message: "User not found" });
    }

    res.status(200).send({
      _id: activeUser._id,
      name: activeUser.name,
      photoURL: activeUser.photoURL || activeUser.image,
      isPremium: activeUser.isPremium || false
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).send({ message: "Invalid ID format or server error" });
  }
});

app.get('/lessons-reports', verifyToken, async (req, res) => {
  try {
    const db = await getDb();
    const reportedLessons = await db.collection("lessons-reports").find().toArray();
    res.status(200).send(reportedLessons);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch reported lessons." });
  }
});

app.delete('/lessons-reports/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    // 🚨 Typo Fix: Corrected 'lesssons-reports' to 'lessons-reports'
    const result = await db.collection("lessons-reports").deleteOne({_id: new ObjectId(id)});
    res.status(200).send(result);
  } catch (error) {
    console.error("Error deleting report", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: "Authentication User ID is required." });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'bdt',
            product_data: {
              name: 'WisdomLog Premium Access',
              description: 'Lifetime complete access to unlock all premium life lessons.',
            },
            unit_amount: 150000,
          },
          quantity: 1,
        },
      ],
      metadata: { userId },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe Session Error:", error);
    res.status(500).json({ message: "Failed to create Stripe payment gate." });
  }
});

// Remove the standalone client.connect() blocking listener at the bottom 
// and only fall back to app.listen in dev mode.
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`App running on port ${port}`);
  });
}

module.exports = app;