const express = require('express');
const dotenv = require("dotenv")
const cors = require('cors')
const app = express();
app.use(cors())
const port = process.env.PORT || 8000;



const { MongoClient, ServerApiVersion } = require('mongodb');

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

    app.get('/pets', async(req,res)=>{
    const cursor = petsCollection.find();
    const result = await cursor.toArray();
    res.send(result)
})
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Hello World!');
});


app.listen(port, ()=>{
    console.log(`App running on port ${port}`);
    
})