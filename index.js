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

// A reusable database helper that handles serverless environments flawlessly
function getDb() {
  return client.db("wisdomlog");
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
        const database = getDb();
        
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
    return res.status(404).json({ message: "Unauthorized" });
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
    return res.status(403).json({ message: "Forbidden" });
  }
};

// =========================================================================
// 🌐 CORE API ROUTES
// =========================================================================

app.get('/lessons', async (req, res) => {
  const result = await getDb().collection("lessons").find().toArray();
  res.send(result);
});

app.post('/lessons', async (req, res) => {
  try {
    const lessonData = req.body;
    const result = await getDb().collection("lessons").insertOne(lessonData);
    res.status(201).send(result); 
  } catch (error) {
    console.error("Error saving Lesson:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.get('/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await getDb().collection("lessons").findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).send({ message: "lesson not found" });
    }
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Invalid ID format or server error" });
  }
});

app.post('/comments', async (req, res) => {
  try {
    const commentData = req.body;
    await getDb().collection("comments").insertOne(commentData);
    res.sendStatus(201);
  } catch (error) {
    res.status(500).send({ message: `Error: ${error}` });
  }
});

app.get('/comments', async (req, res) => {
  try {
    const { lessonId } = req.query;
    const result = await getDb().collection("comments").find({ lessonId }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: `Error: ${error}` });
  }
});

app.post('/favorites', async (req, res) => {
  try {
    const favoriteData = req.body;
    const result = await getDb().collection("favorites").insertOne(favoriteData);
    res.status(201).send(result); 
  } catch (error) {
    console.error("Error saving favorite:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});

app.get('/favorites/check', async (req, res) => {
  try {
    const { userId, lessonId } = req.query;
    if (!userId || !lessonId) {
      return res.status(400).send({ message: "Both userId and lessonId are required." });
    }

    const existingFavorite = await getDb().collection("favorites").findOne({ userId, lessonId });
    res.status(200).send({ isSaved: !!existingFavorite });
  } catch (error) {
    console.error("Error checking favorite status:", error);
    res.status(500).send({ message: `Error checking status: ${error.message}` });
  }
});

app.post('/lesson-reports', async (req, res) => {
  try {
    const report = req.body;
    const result = await getDb().collection("lessons-reports").insertOne(report);
    res.status(201).send(result); 
  } catch (error) {
    console.error("Error saving report:", error);
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

// =========================================================================
// 🚀 SERVER LIFECYCLE MANAGEMENT
// =========================================================================

// Connect the client immediately for production runtime stability
client.connect().then(() => {
  console.log("✅ Successfully connected to MongoDB Atlas pool!");
}).catch(err => {
  console.error("🚨 Initial MongoDB connection pool setup failed:", err);
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`App running on port ${port}`);
  });
}

module.exports = app;