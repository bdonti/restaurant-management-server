const express = require('express');
const app= express();
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
//private key generate require('crypto').randomBytes(64).toString('hex')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;


//middleware
const corsOption = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  Credential: true,
  optionSuccessStatus: 200
}
app.use(cors(corsOption));
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iedqjux.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)


    const menuCollection = client.db('bistroDB').collection('menu');
    const reviewCollection = client.db('bistroDB').collection('reviews');
    const cartCollection = client.db('bistroDB').collection('carts');
    const userCollection = client.db('bistroDB').collection('users');
    const paymentCollection = client.db('bistroDB').collection('payments');

    //jwt related apis
    app.post('/jwt', async(req , res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1h'});
      res.send({token});
    })

    //jwt middlewares
    const verifyToken = (req, res, next) => {
      console.log('inside verify token', req.headers.authorization);
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }

      const token = authHeader.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized Access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    }
    
    //user related apis
    app.get('/users', verifyToken, verifyAdmin, async(req,res)=>{
      const result= await userCollection.find().toArray();
      res.send(result);
    })

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      res.send({ admin });
    })

    app.post('/users', async(req,res)=>{
      const user= req.body;
      const query = {email: user.email};
      const existingUser = await userCollection.findOne(query);
      if(existingUser){
        return res.send({message: 'User already exists'});
      }
      const result= await userCollection.insertOne(user);
      res.send(result);
    })

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async(req,res)=>{
      const id = req.params.id;
      const filter= {_id: new ObjectId(id)};
      const updatedDoc= {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    app.delete('/users/:id', verifyToken, verifyAdmin, async(req,res)=>{
      const id= req.params.id;
      const query = {_id: new ObjectId(id)};
      const result= await userCollection.deleteOne(query);
      res.send(result);
    })


    //menu related apis
    app.get('/menu', async(req,res)=>{
        const result = await menuCollection.find().toArray();
        res.send(result);
    })

    app.post('/menu', verifyToken, verifyAdmin, async(req,res)=>{
      const menu = req.body;
      const result = await menuCollection.insertOne(menu);
      res.send(result);
    })

    app.delete('/menu/:id', verifyToken, verifyAdmin, (req, res) => {
      const id = req.params.id;
      
      console.log(`Received request to delete item with ID: ${id}`);
      
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }
    
      const query = { _id: new ObjectId(id) };
    
      menuCollection.deleteOne(query)
        .then(result => {
          if (result.deletedCount === 1) {
            console.log(`Successfully deleted item with ID: ${id}`);
            res.send({ message: 'Item successfully deleted', deletedCount: 1 });
          } else {
            console.log(`Item with ID: ${id} not found`);
            res.status(404).send({ message: 'Item not found', deletedCount: 0 });
          }
        })
        .catch(error => {
          console.error('Error deleting item:', error);
          res.status(500).send({ message: 'Internal server error' });
        });
    });
    

    app.get('/reviews', async(req,res)=>{
        const result = await reviewCollection.find().toArray();
        res.send(result);
    })


    //carts collection related apis
    app.get('/carts', async(req,res)=>{
      const email = req.query.email;
      const query = {userEmail: email};
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    })

    app.post('/carts', async(req,res)=>{
      const cartItem= req.body;
      const result= await cartCollection.insertOne(cartItem);
      res.send(result);
    })

    app.delete('/carts/:id', async(req,res)=>{
      const id= req.params.id;
      const query = {_id: new ObjectId(id)};
      const result= await cartCollection.deleteOne(query);
      res.send(result);
    })

    //payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, 'amount inside the intent')

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    });

    
    app.get('/payments/:email', verifyToken, async (req, res) => {
      const query = { email: req.params.email }
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    })

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      //  carefully delete each item from the cart
      console.log('payment info', payment);
      const query = {
        _id: {
          $in: payment.cartIds.map(id => new ObjectId(id))
        }
      };

      const deleteResult = await cartCollection.deleteMany(query);

      res.send({ paymentResult, deleteResult });
    })

     // stats or analytics
     app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // this is not the best way
      // const payments = await paymentCollection.find().toArray();
      // const revenue = payments.reduce((total, payment) => total + payment.price, 0);

      const result = await paymentCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: '$price'
            }
          }
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;

      res.send({
        users,
        menuItems,
        orders,
        revenue
      })
    })


    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);


app.get('/', (req,res)=>{
    res.send("Bistro Boss Website server is running");
})

app.listen(port, ()=>{
    console.log(`Bistro Boss server is running on port ${port}`);
})