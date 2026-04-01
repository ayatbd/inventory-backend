const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// midlwares
app.use(cors());
app.use(express.json());

// ---------------------------

// ---------------------------

// const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y1sglpm.mongodb.net/?retryWrites=true&w=majority`;
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-sxrczlw-shard-00-00.y1sglpm.mongodb.net:27017,ac-sxrczlw-shard-00-01.y1sglpm.mongodb.net:27017,ac-sxrczlw-shard-00-02.y1sglpm.mongodb.net:27017/?ssl=true&replicaSet=atlas-o2tvq8-shard-0&authSource=admin&appName=Cluster0`;
console.log(uri);
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const usersCollection = client.db("easyMartDB").collection("users");
    const productsCollection = client.db("easyMartDB").collection("products");

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.error(error);
  }
}
run().catch(console.dir);
// ---------------------------
app.get("/", (req, res) => {
  res.send("web server is running");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
