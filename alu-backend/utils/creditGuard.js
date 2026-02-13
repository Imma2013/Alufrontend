const cron = require('node-cron');
const { User } = require('../config/db');

const initCreditGuard = () => {
  // Run at midnight UTC (0 0 * * *)
  cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running Daily Credit Reset...');
    try {
      const now = new Date();
      const users = await User.find({});

      let dailyResetCount = 0;
      let monthlyResetCount = 0;

      for (const user of users) {
        const updates = {};

        // Daily reset: AI limits
        updates.dailyImages = 0;
        updates.dailyShorts = 0;
        updates.dailyLongVids = 0;
        updates.lastResetDate = now;
        dailyResetCount++;

        // Monthly reset: check if month changed
        const lastMonthlyReset = user.lastMonthlyResetDate || new Date(0);
        if (now.getMonth() !== lastMonthlyReset.getMonth() || now.getFullYear() !== lastMonthlyReset.getFullYear()) {
          updates.monthlyShorts = 0;
          updates.lastMonthlyResetDate = now;
          monthlyResetCount++;
        }

        await User.updateOne({ userId: user.userId }, { $set: updates });
      }

      console.log(`✅ Daily reset: ${dailyResetCount} users | Monthly reset: ${monthlyResetCount} users`);
    } catch (error) {
      console.error('❌ Error resetting credits:', error);
    }
  }, {
    timezone: "UTC"
  });
  console.log('🛡️ CreditGuard Initialized: Daily + Monthly reset scheduled for Midnight UTC.');
};

module.exports = initCreditGuard;
