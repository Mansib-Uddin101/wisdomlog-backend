const express = require('express');
const dotenv = require("dotenv")
const cors = require('cors')
const app = express();
app.use(cors())
require('dotenv').config()
app.use(express.json());

const port = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
const sample_data = {
  "name": "Niledo",
  "species": "Dog",
  "breed": "German Shepherd",
  "age": "3 years",
  "gender": "Male",
  "imageUrl": "https://images.unsplash.com/photo-1589941013453-ec89f33b5e95?auto=format&fit=crop&q=80&w=600",
  "healthStatus": "Excellent",
  "vaccinationStatus": "Fully Vaccinated",
  "location": "Dhaka, Bangladesh",
  "adoptionFee": 500,
  "description": "Highly intelligent and protective. Milo knows basic commands and needs an active owner.",
  "ownerEmail": "milo.owner@example.com",
  "status": "available",
  "createdAt": "2026-05-22T08:15:00.000Z",
  "ownerId": "12345678988"
}
async function run() {
  try {
    await client.connect();
    const db = client.db("petbuddy");
    const petsCollection = db.collection("pets")

    app.get('/pets', async (req, res) => {
      const cursor = petsCollection.find();
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get('/my-listings', async (req, res) => {
      try {
        const { ownerId } = req.query;

        if (!ownerId) {
          return res.status(400).send({ message: "Owner ID query parameter is required" });
        }

        const cursor = petsCollection.find({ ownerId: ownerId });
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get('/pets/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await petsCollection.findOne({ _id: new ObjectId(id) });

        if (!result) {
          return res.status(404).send({ message: "Pet not found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Invalid ID format or server error" });
      }
    });

    app.post('/pets', async (req, res) => {
      try {
        const petData = req.body;

        // Guard clause: Ensure req.body isn't empty or undefined
        if (!petData || Object.keys(petData).length === 0) {
          return res.status(400).send({ message: "Bad Request: Please provide pet data." });
        }

        const result = await petsCollection.insertOne(petData);
        res.status(201).send(result); // 201 is the ideal HTTP status for successful creation

      } catch (error) {
        console.error("Database Insert Error:", error); // Log the real error to your terminal for debugging
        res.status(500).send({ message: "Request failed", error: error.message });
      }
    });


  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(port, () => {
  console.log(`App running on port ${port}`);

})