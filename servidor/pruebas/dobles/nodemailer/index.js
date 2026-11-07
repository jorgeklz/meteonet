const enviados = [];
module.exports = {
  enviados,
  createTransport: () => ({ sendMail: async (m) => { enviados.push(m); return { messageId: 'doble' }; } }),
};
