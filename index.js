require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection String
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-sxrczlw-shard-00-00.y1sglpm.mongodb.net:27017,ac-sxrczlw-shard-00-01.y1sglpm.mongodb.net:27017,ac-sxrczlw-shard-00-02.y1sglpm.mongodb.net:27017/?ssl=true&replicaSet=atlas-o2tvq8-shard-0&authSource=admin&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect to Database
    // await client.connect(); // Optional in some Atlas environments, but good to keep
    const db = client.db("inventoryDB");

    // Collections
    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const ordersCollection = db.collection("orders");
    const activitiesCollection = db.collection("activities");

    // Helper: Log Activity
    const logAction = async (message) => {
      await activitiesCollection.insertOne({
        action: message,
        timestamp: new Date(),
      });
    };

    // ---------------------------------------------------------
    // 1. AUTHENTICATION (Plain Text)
    // ---------------------------------------------------------
    app.post("/signup", async (req, res) => {
      const result = await usersCollection.insertOne(req.body);
      res.send(result);
    });

    app.post("/login", async (req, res) => {
      const { email, password } = req.body;
      const user = await usersCollection.findOne({ email, password });
      if (user) res.send({ success: true, user: { email: user.email } });
      else res.status(401).send({ message: "Invalid credentials" });
    });

    // ---------------------------------------------------------
    // 2. PRODUCT MANAGEMENT
    // ---------------------------------------------------------
    app.get("/products", async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    });

    app.post("/products", async (req, res) => {
      const product = req.body;
      product.stock = Number(product.stock);
      product.threshold = Number(product.threshold);
      product.status = product.stock > 0 ? "Active" : "Out of Stock";

      const result = await productsCollection.insertOne(product);
      await logAction(`Product "${product.name}" added to inventory.`);
      res.send(result);
    });

    // Restock Logic
    app.patch("/products/:id/restock", async (req, res) => {
      const id = req.params.id;
      const addAmount = Number(req.body.quantity);
      const product = await productsCollection.findOne({
        _id: new ObjectId(id),
      });

      const newStock = product.stock + addAmount;
      const updateDoc = {
        $set: {
          stock: newStock,
          status: newStock > 0 ? "Active" : "Out of Stock",
        },
      };
      await productsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
      await logAction(`Restocked ${product.name}. New quantity: ${newStock}`);
      res.send({ success: true });
    });

    // ---------------------------------------------------------
    // 3. SMART ORDER MANAGEMENT (Stock Logic & Conflicts)
    // ---------------------------------------------------------
    app.post("/orders", async (req, res) => {
      const orderData = req.body; // { customerName, items: [{productId, quantity, price, name}] }
      let totalPrice = 0;

      try {
        // A. Conflict Detection: Verify all items first
        for (const item of orderData.items) {
          const product = await productsCollection.findOne({
            _id: new ObjectId(item.productId),
          });

          if (!product || product.status === "Out of Stock") {
            return res
              .status(400)
              .send({ message: `${item.name} is currently unavailable.` });
          }

          if (product.stock < item.quantity) {
            return res.status(400).send({
              message: `Insufficient stock for ${product.name}. Only ${product.stock} left.`,
            });
          }
          totalPrice += item.price * item.quantity;
        }

        // B. Execution: Deduct Stock & Handle Auto-Status
        for (const item of orderData.items) {
          const product = await productsCollection.findOne({
            _id: new ObjectId(item.productId),
          });
          const updatedStock = product.stock - item.quantity;

          await productsCollection.updateOne(
            { _id: new ObjectId(item.productId) },
            {
              $set: {
                stock: updatedStock,
                status: updatedStock === 0 ? "Out of Stock" : "Active",
              },
            },
          );

          // C. Restock Queue Trigger (Activity log if below threshold)
          if (updatedStock <= product.threshold) {
            await logAction(
              `LOW STOCK: ${product.name} is now at ${updatedStock} units.`,
            );
          }
        }

        // D. Save Order
        const finalOrder = {
          ...orderData,
          totalPrice,
          status: "Pending",
          createdAt: new Date(),
        };
        const result = await ordersCollection.insertOne(finalOrder);
        await logAction(
          `New Order #${result.insertedId.toString().slice(-5)} created.`,
        );

        res.send({ success: true, orderId: result.insertedId });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/orders", async (req, res) => {
      const result = await ordersCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // ---------------------------------------------------------
    // 4. DASHBOARD INSIGHTS (Aggregated Data)
    // ---------------------------------------------------------
    app.get("/dashboard-stats", async (req, res) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Stats
      const ordersToday = await ordersCollection
        .find({ createdAt: { $gte: today } })
        .toArray();
      const pendingCount = await ordersCollection.countDocuments({
        status: "Pending",
      });

      // Revenue
      const revenue = ordersToday.reduce(
        (sum, order) => sum + (order.totalPrice || 0),
        0,
      );

      // Low Stock (Restock Queue)
      const lowStockItems = await productsCollection
        .find({
          $expr: { $lte: ["$stock", "$threshold"] },
        })
        .sort({ stock: 1 })
        .toArray();

      // Recent Logs
      const logs = await activitiesCollection
        .find()
        .sort({ timestamp: -1 })
        .limit(8)
        .toArray();

      res.send({
        revenueToday: revenue,
        ordersTodayCount: ordersToday.length,
        pendingOrders: pendingCount,
        lowStockCount: lowStockItems.length,
        lowStockItems,
        activities: logs,
      });
    });

    console.log("MongoDB Connected and API Routes Initialized!");
  } catch (error) {
    console.error("Connection Error:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Smart Inventory Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
