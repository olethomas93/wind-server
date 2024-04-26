var { expressjwt: jwts } = require("express-jwt");
const config = require('./config.js');

async function isRevoked(req, payload) {
  console.log(payload);
  if (payload.isAdmin == false) {
    console.log('Not Admin');
    return true;
  }
  console.log('Admin');
  return false;
}
function jwt() {
	const { secret } = config.jwt;
	return jwts({
		secret,
		getToken: function fromHeaderOrQuerystring(req) {
			const token = req.headers.authorization
				? req.headers.authorization.split(' ')[1]
				: req.query.token;
			if (token) return token;
			return null;
		},
		algorithms: ['HS256'],
		isRevoked,
	}).unless({
		path: [
			// public routes that don't require authentication
			/\/v[1-9](\d)*\/(auth|docs)\/.*/,
		],
	});
}

module.exports = jwt;
