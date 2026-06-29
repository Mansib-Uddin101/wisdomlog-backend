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
  const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });

  async function run() {
    try {
      await client.connect();
      const db = client.db("petbuddy");
      const petsCollection = db.collection("pets")
      const requestsCollection = db.collection("requests")
      const JWKS = createRemoteJWKSet(
        new URL('http://localhost:3000/api/auth/jwks')
      )

      const verifyToken = async (req, res, next) => {
        const authHeader = req?.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ message: "Unauthorized" })
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
          return res.status(401).json({ message: "Unauthorized" })
        }
        try{
          const { payload } = await jwtVerify(token, JWKS)
          console.log(payload);
          next()
          
        } catch {
          return res.status(403).json({message: "Forbidden"})
        }
      }

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

      app.get('/pets/:id', verifyToken,  async (req, res) => {
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

      app.post('/pets', verifyToken, async (req, res) => {
        try {
          const petData = req.body;

          if (!petData || Object.keys(petData).length === 0) {
            return res.status(400).send({ message: "Bad Request: Please provide pet data." });
          }

          const result = await petsCollection.insertOne(petData);
          res.status(201).send(result);
        } catch (error) {
          console.error("Database Insert Error:", error);
          res.status(500).send({ message: "Request failed", error: error.message });
        }
      });

      // UPDATE PET LISTING (For Update Modal)
      app.put('/pets/:id', async (req, res) => {
        try {
          const { id } = req.params;
          const updatedBody = req.body;

          // Clean out fields that shouldn't be altered or MongoDB might crash
          delete updatedBody._id;

          const query = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: updatedBody
          };

          const result = await petsCollection.findOneAndUpdate(
            query,
            updateDoc,
            { returnDocument: 'after' } // Returns the newly modified object back to frontend
          );

          if (!result) {
            return res.status(404).send({ success: false, message: "Pet listing not found" });
          }

          res.send(result);
        } catch (error) {
          res.status(500).send({ success: false, message: "Server error", error: error.message });
        }
      });

      app.delete('/pets/:id', async (req, res) => {
        try {
          const { id } = req.params;
          const query = { _id: new ObjectId(id) };

          const result = await petsCollection.deleteOne(query);

          if (result.deletedCount === 1) {
            await requestsCollection.deleteMany({ petId: id });

            res.send({ success: true, message: "Pet listing and associated requests removed successfully" });
          } else {
            res.status(404).send({ success: false, message: "No listing found with this ID" });
          }
        } catch (error) {
          res.status(500).send({ success: false, message: "Server error", error: error.message });
        }
      });


      // --- ADOPTION REQUESTS API ---

      app.post('/requests', verifyToken, async (req, res) => {
        try {
          const requestData = req.body;

          if (!requestData || Object.keys(requestData).length === 0) {
            return res.status(400).send({ message: "Bad Request: Please provide request data." });
          }

          const { requesterId, petId } = requestData;

          if (!requesterId || !petId) {
            return res.status(400).send({ message: "Missing required fields: requesterId and petId are required." });
          }

          const existingRequest = await requestsCollection.findOne({
            requesterId: requesterId,
            petId: petId,
            status: { $in: ['Pending', 'Approved', 'Accepted'] } 
          });

          if (existingRequest) {
            return res.status(409).send({
              message: "You have already submitted an active application for this pet."
            });
          }

          if (!requestData.status) {
            requestData.status = 'Pending';
          }

          requestData.createdAt = new Date();

          const result = await requestsCollection.insertOne(requestData);
          res.status(201).send(result);
        } catch (error) {
          console.error("Database Insert Error:", error);
          res.status(500).send({ message: "Request failed", error: error.message });
        }
      });

      app.get('/requests', async (req, res) => {
        try {
          const { ownerId, requesterId } = req.query;

          // Create a dynamic query object based on what's passed
          const query = {};

          if (ownerId) {
            query.ownerId = ownerId;
          } else if (requesterId) {
            query.requesterId = requesterId;
          } else {
            // If neither is provided, prevent fetching the entire DB blindly
            return res.status(400).send({
              message: "Either ownerId or requesterId query parameter is required"
            });
          }

          const cursor = requestsCollection.find(query);
          const result = await cursor.toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Server error", error: error.message });
        }
      });

      // FETCH INCOMING REQUESTS BY PET ID (For frontend Requests Modal)
      app.get('/pet-requests', verifyToken, async (req, res) => {
        try {
          const { petId } = req.query;

          if (!petId) {
            return res.status(400).send({ message: "Pet ID query parameter is required" });
          }

          const cursor = requestsCollection.find({ petId: petId });
          const result = await cursor.toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Server error", error: error.message });
        }
      });

      app.delete('/requests/:id',  async (req, res) => {
        try {
          const { id } = req.params;

          const query = { _id: new ObjectId(id) };
          const result = await requestsCollection.deleteOne(query);

          if (result.deletedCount === 1) {
            res.send({ success: true, message: "Adoption request deleted successfully" });
          } else {
            res.status(404).send({ success: false, message: "No request found with this ID" });
          }
        } catch (error) {
          res.status(500).send({ success: false, message: "Server error", error: error.message });
        }
      });

      app.patch('/requests/:id', async (req, res) => {
        try {
          const { id } = req.params;
          const { status } = req.body; // Expects 'approved' or 'rejected'

          if (!status) {
            return res.status(400).send({ success: false, message: "Status is required" });
          }

          const query = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: { status: status.toLowerCase() }
          };

          // Use findOneAndUpdate to get the document data and update it in one step
          const updatedRequest = await requestsCollection.findOneAndUpdate(
            query,
            updateDoc,
            { returnDocument: 'after' } // Returns the document after modifications are applied
          );

          if (!updatedRequest) {
            return res.status(404).send({ success: false, message: "Adoption request not found" });
          }

          // Cascading Logic: If this request is approved, update the pet listing status to 'adopted'
          if (status.toLowerCase() === 'approved' && updatedRequest.petId) {
            await petsCollection.updateOne(
              { _id: new ObjectId(updatedRequest.petId) },
              { $set: { status: 'adopted' } } // Matches your backend status schema pattern perfectly
            );
          }

          res.send({
            success: true,
            message: `Adoption request successfully updated to ${status}`,
            data: updatedRequest
          });

        } catch (error) {
          res.status(500).send({ success: false, message: "Server error", error: error.message });
        }
      });

    } finally {
      // Keep client alive
    }
  }
  run().catch(console.dir);

  app.listen(port, () => {
    console.log(`App running on port ${port}`);
  });