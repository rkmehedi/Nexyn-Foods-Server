const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a85vji0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    

    const database = client.db("nexynFoodsDB");
    const foodCollection = database.collection("foods");
    const orderCollection = database.collection("orders");

    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    });

    app.post('/foods', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.body.added_by.email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      try {
        const newFood = req.body;
        newFood.purchase_count = 0;
        const result = await foodCollection.insertOne(newFood);
        res.status(201).send(result);
      } catch {
        res.status(500).send({ message: "Failed to add food item" });
      }
    });

    app.get('/foods', async (req, res) => {
      try {
        const sortField = req.query.sortField || 'food_name';
        const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
        const sortObject = {};
        sortObject[sortField] = sortOrder;
        const result = await foodCollection.find().sort(sortObject).toArray();
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to fetch food items" });
      }
    });

    app.get('/top-foods', async (req, res) => {
      try {
        const result = await foodCollection.find().sort({ purchase_count: -1 }).limit(6).toArray();
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to fetch top food items" });
      }
    });

    app.get('/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await foodCollection.findOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to fetch single food item" });
      }
    });

    app.get('/my-foods/:email', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.params.email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      try {
        const email = req.params.email;
        const result = await foodCollection.find({ 'added_by.email': email }).toArray();
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to fetch user's food items" });
      }
    });

    app.put('/foods/:id', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.body.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      try {
        const id = req.params.id;
        const { email, ...updatedFoodData } = req.body;
        const foodItem = await foodCollection.findOne({ _id: new ObjectId(id) });
        if (foodItem.added_by.email !== email) {
          return res.status(403).send({ message: "Forbidden: You can only update your own food items." });
        }
        const result = await foodCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...updatedFoodData } }
        );
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to update food item" });
      }
    });

    app.delete('/foods/:id', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.body.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      try {
        const id = req.params.id;
        const { email } = req.body;
        const foodItem = await foodCollection.findOne({ _id: new ObjectId(id) });
        if (foodItem.added_by.email !== email) {
          return res.status(403).send({ message: "Forbidden: You can only delete your own food items." });
        }
        const result = await foodCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to delete food item" });
      }
    });

    app.post('/purchase', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.body.buyer_email) {
        return res.status(403).send({ message: "Forbidden: You can only purchase items for yourself." });
      }
      try {
        const order = req.body;
        const { foodId, purchase_quantity, buyer_email } = order;
        if (purchase_quantity <= 0) {
          return res.status(400).send({ message: "Invalid purchase quantity." });
        }
        const foodItem = await foodCollection.findOne({ _id: new ObjectId(foodId) });
        if (!foodItem) {
          return res.status(404).send({ message: "Food item not found." });
        }
        if (foodItem.added_by.email === buyer_email) {
          return res.status(400).send({ message: "You cannot purchase your own food item." });
        }
        if (foodItem.quantity < purchase_quantity) {
          return res.status(400).send({ message: "Not enough quantity available." });
        }
        order.buying_date = new Date();
        const orderResult = await orderCollection.insertOne(order);
        const foodUpdateResult = await foodCollection.updateOne(
          { _id: new ObjectId(foodId) },
          { $inc: { quantity: -purchase_quantity, purchase_count: 1 } }
        );
        res.status(201).send({ orderResult, foodUpdateResult });
      } catch {
        res.status(500).send({ message: "Failed to process purchase" });
      }
    });

    app.get('/orders/:email', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.params.email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      try {
        const orders = await orderCollection.find({ buyer_email: req.params.email }).toArray();
        res.send(orders);
      } catch {
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    app.delete('/orders/:id', verifyToken, async (req, res) => {
      if (req.decoded.email !== req.body.email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      try {
        const id = req.params.id;
        const { email } = req.body;
        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        if (!order) {
          return res.status(404).send({ message: "Order not found." });
        }
        if (order.buyer_email !== email) {
          return res.status(403).send({ message: "Forbidden: You are not authorized to delete this order." });
        }
        const result = await orderCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to delete order" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Nexyn Foods Server is running!');
});

app.listen(port, () => {
  console.log(`Nexyn Foods server is running on port ${port}`);
});
