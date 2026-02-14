const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { User } = require('../config/db');
const clerkAuth = require('../middleware/clerkAuth');

let stripe = null;
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

// Credit amounts for one-time purchases
const IMAGE_CREDIT_PACK = {
  bonusImages: Number(process.env.CREDIT_PACK_IMAGES || 30),
};
const SHORT_CREDIT_PACK = {
  bonusShorts: Number(process.env.CREDIT_PACK_SHORTS || 1),
};

/**
 * POST /create-checkout-session
 * Creates a Stripe Checkout Session.
 * Body: { priceId, mode }
 *   mode: 'subscription' (Pro monthly), 'payment' (image credits), or 'short' (short credits)
 */
router.post('/create-checkout-session', clerkAuth, async (req, res) => {
  const userId = req.auth.sub;
  const { priceId, mode } = req.body;

  if (!priceId) {
    return res.status(400).json({ error: 'Missing priceId' });
  }
  if (!String(priceId).startsWith('price_')) {
    return res.status(400).json({ error: 'Invalid Stripe priceId. Use a price_... ID, not a product ID.' });
  }
  const stripeClient = getStripe();
  if (!stripeClient) {
    return res.status(503).json({ error: 'Payments unavailable: STRIPE_SECRET_KEY is missing on backend.' });
  }

  const purchaseType = mode === 'short'
    ? 'short_credit'
    : (mode === 'payment' ? 'image_credit' : 'subscription');
  const checkoutMode = purchaseType === 'subscription' ? 'subscription' : 'payment';
  const expectedPriceId = purchaseType === 'subscription'
    ? process.env.STRIPE_PRO_PRICE_ID
    : (purchaseType === 'short_credit' ? process.env.STRIPE_SHORT_PRICE_ID : process.env.STRIPE_IMAGE_PRICE_ID);

  if (expectedPriceId && expectedPriceId !== priceId) {
    return res.status(400).json({ error: 'Invalid priceId for selected purchase mode.' });
  }

  try {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: checkoutMode,
      success_url: `${process.env.FRONTEND_URL || 'https://alu-teal-pi.vercel.app'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://alu-teal-pi.vercel.app'}`,
      client_reference_id: userId,
      metadata: {
        userId: userId,
        purchaseType,
      }
    });

    res.json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('Stripe Checkout Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhook
 * Handles Stripe webhooks to fulfill orders/subscriptions.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripeClient = getStripe();
  if (!stripeClient) {
    return res.status(503).send('Payments unavailable');
  }
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const purchaseType = session.metadata?.purchaseType || session.mode;

      console.log(`Payment successful for user ${userId}, type: ${purchaseType}`);

      if (purchaseType === 'subscription') {
        // Pro subscription — mark user as Pro
        await User.findOneAndUpdate(
          { userId },
          { isPro: true, subscriptionId: session.subscription, stripeCustomerId: session.customer },
          { upsert: true }
        );
        console.log(`User ${userId} upgraded to Pro`);
      } else if (purchaseType === 'short_credit') {
        // One-time short credit pack
        await User.findOneAndUpdate(
          { userId },
          {
            $inc: {
              bonusShorts: SHORT_CREDIT_PACK.bonusShorts,
            },
            stripeCustomerId: session.customer,
          },
          { upsert: true }
        );
        console.log(`User ${userId} received short credit pack: +${SHORT_CREDIT_PACK.bonusShorts} shorts`);
      } else {
        // One-time image credit pack
        await User.findOneAndUpdate(
          { userId },
          {
            $inc: {
              bonusImages: IMAGE_CREDIT_PACK.bonusImages,
            },
            stripeCustomerId: session.customer,
          },
          { upsert: true }
        );
        console.log(`User ${userId} received image credit pack: +${IMAGE_CREDIT_PACK.bonusImages} images`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      // Subscription cancelled — downgrade from Pro
      const subscription = event.data.object;
      const customer = subscription.customer;
      const user = await User.findOne({ stripeCustomerId: customer });
      if (user) {
        user.isPro = false;
        user.subscriptionId = undefined;
        await user.save();
        console.log(`User ${user.userId} downgraded from Pro (subscription cancelled)`);
      }
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.send();
});

module.exports = router;
