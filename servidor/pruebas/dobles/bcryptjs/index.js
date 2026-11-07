const crypto = require('node:crypto');
const sal = 'doble';
module.exports = {
  hashSync: (c) => '$dbl$' + crypto.createHash('sha256').update(sal + c).digest('hex'),
  compareSync: (c, h) => module.exports.hashSync(c) === h,
};
