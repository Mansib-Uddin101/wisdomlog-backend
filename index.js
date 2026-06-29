const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

// Initialize environment variables immediately
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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

const db = client.db("wisdomlog");
const usersCollection = db.collection("users");
const lessonsCollection = db.collection("lessons");
const lessonsReportsCollection = db.collection("lessons-reports");
const favoritesCollection = db.collection("favorites");
const commentsCollection = db.collection("comments");


// Initialize JWKS context
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

// Middleware: Verify JWT Token
const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(404).json({ message: "Unauthorized" }); // Kept your original 404, though 401 is standard
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload; // Attach payload for potential route usage
    next();
  } catch {
    return res.status(403).json({ message: "Forbidden" });
  }
};

app.get('/lessons', async (req, res) => {
  const cursor = lessonsCollection.find();
  const result = await cursor.toArray();
  res.send(result)
})
app.get('/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await lessonsCollection.findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).send({ message: "lesson not found" });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Invalid ID format or server error" });
  }
});

app.post('/comments',  async (req, res) => {
  try{
    const commentData = req.body;
    const result = await commentsCollection.insertOne(commentData);
    res.status(201)

  }catch(error){
     res.status(500).send({ message: `Error: ${error}` });
  }
})
app.get('/comments',  async (req, res) => {
  try{
    const { lessonId } = req.query;
    const result = await commentsCollection.find({lessonId: lessonId}).toArray();
    res.send(result)
  }catch(error){
     res.status(500).send({ message: `Error: ${error}` });
  }
})



app.post('/favorites', async (req, res) => {
  try {
    const favoriteData = req.body;
    const result = await favoritesCollection.insertOne(favoriteData);
    
    // ADDED: .send(result) so the client receives a response and closes the connection
    res.status(201).send(result); 

  } catch(error) {
    console.error("Error saving favorite:", error);
    res.status(500).send({ message: `Error: ${error.message}` });
  }
});
app.get('/favorites/check', async (req, res) => {
  try {
    const { userId, lessonId } = req.query;

    // 1. Ensure both parameters were actually provided
    if (!userId || !lessonId) {
      return res.status(400).send({ message: "Both userId and lessonId are required." });
    }

    // 2. Look for just ONE matching document in the database
    const existingFavorite = await favoritesCollection.findOne({ 
      userId: userId, 
      lessonId: lessonId 
    });

    // 3. If a document was found, return true. If null, return false.
    // The !! (double bang) simply converts the object/null into a strict boolean.
    res.status(200).send({ isSaved: !!existingFavorite });

  } catch (error) {
    console.error("Error checking favorite status:", error);
    res.status(500).send({ message: `Error checking status: ${error.message}` });
  }
});


if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`App running on port ${port}`);
  });
}

// EXPORT FOR VERCEL
module.exports = app;