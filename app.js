var express = require("express");
var bodyParser = require("body-parser");
var moment = require("moment");
var request = require('request');
var fs = require('fs');
var Q = require('q');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const grib2json = require('weacast-grib2json');
const { json } = require("express");
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();




// InfluxDB connection configuration
const influxDBConfig = {
	url: 'http://influxdb:8086',
	token: '3B1LqpAdtlKXpRvSQcjk-PkwpjhLiyiOF38c1S6gGMmiofjxZF8M2l-YlYiqhV293wJif8u2Ygrd1EOiwMzipg==',
	org: 'Northei',
	bucket: 'iot',
  };
  
const influxDBClient = new InfluxDB(influxDBConfig);
//const mqtt = require('mqtt');

const pool = new Pool({
	user: 'admin',
	host: 'db',
	database: 'iot',
	password: '3d6768c7',
	port: 5432,
  });


var app = express();




app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


var port = process.env.PORT || 8080;
var host = process.env.HOST || '0.0.0.0';
var baseDir ='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl';

app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
	// Respond to preflight request
	if (req.method === 'OPTIONS') {
	  res.sendStatus(200);
	} else {
	  next();
	}
  });

// cors config
var whitelist = [
	'http://localhost:63342',
	'http://localhost:3000/*',
	'http://localhost:4000',
	'https://friliv.netlify.app',
	'https://friliv.northei.no',
	'*'
];




var corsOptions = {
	origin: function(origin, callback){
		var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
		callback(null, originIsWhitelisted);
	}
};



app.get('/', cors(corsOptions), function(req, res){
    res.send('Største byen i finnmark er Alta');
});
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.sendStatus(401);
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.get('/aurora/model',cors(corsOptions),function(req ,res){

request.get({url:'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', json: true},function(err, response, data){

var coords= data.coordinates 
var result=[]
for(var i in coords){

	if(coords[i][2]>0){

		result.push([Number(coords[i][1]) || 0 ,Number(coords[i][0]) || 0, Number(coords[i][2]) || 0])
	}

	


}
res.send(result)

})



 


})


app.post('/api/user/register', cors(corsOptions),async (req, res) => {
    const { username, password, roles = ['user'] , customer } = req.body; // Default to array with a single 'user' role
    const hashedPassword = await bcrypt.hash(password, 10);
    
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password, roles, customer) VALUES ($1, $2, $3, $4) RETURNING *',
            [username, hashedPassword, roles , customer]
        );
        res.status(201).json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/user/update/password', cors(corsOptions),authenticateToken,async (req, res) => {
	const { oldPassword, newPassword } = req.body;
    const userId = req.user.id; // Assuming your JWT contains the user ID

    try {
        // Fetch user's current hashed password from the database
        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
        if (rows.length === 0) {
            return res.status(404).send('User not found.');
        }

        // Compare old password with the hashed password stored in the database
        const validPassword = await bcrypt.compare(oldPassword, rows[0].password);
        if (!validPassword) {
            return res.status(403).send('Old password is incorrect.');
        }

        // Hash new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // Update password in the database
        const updateResult = await pool.query(
            'UPDATE users SET password = $1 WHERE id = $2 RETURNING *',
            [hashedNewPassword, userId]
        );

        res.json({ message: "Password updated successfully." });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

const authenticateTokenAndRole = (requiredRole) => (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.sendStatus(401);
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        
        // Assuming the user's roles are included in the JWT and checking if the required role is in the user's roles array
        if (!user.roles.includes(requiredRole)) return res.sendStatus(403);
        
        req.user = user;
        next();
    });
};
app.get('/admin-only', cors(corsOptions), authenticateTokenAndRole('admin'), (req, res) => {
    res.json({ message: "Welcome, admin" });
});


app.post('/api/user/login', cors(corsOptions),  async  (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        
        if (user.rows.length > 0) {
            const isValid = await bcrypt.compare(password, user.rows[0].password);
            
            if (isValid) {
			    const roles = user.rows[0].roles
				const customers = user.rows[0].customers
				const uuid = user.rows[0].id
                const token = jwt.sign({ username: user.rows[0].username, id: user.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '12h' });
                res.json({ token,roles,customers,uuid });
            } else {
                res.status(401).send('Unauthorized');
            }
        } else {
            res.status(404).send('User not found');
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/aurora/forecast',cors(corsOptions),function(req,res){


request.get({url:`https://www.yr.no/api/v0/locations/${req.query.placenumber}/auroraforecast?language=nb`,json:true},function(err,response,data){

if(err){
res.send('error')
}else{


res.send(data)

}

})



})

app.get('/place',cors(corsOptions),function(req,res){


	request.get({url:`https://www.yr.no/api/v0/locations/search?language=nb&lat=${req.query.lat}&lon=${req.query.lng}&accuracy=500`,json:true},function(err,response,data){
	
	if(err){
	res.send('error')
	}else{
	
	
	res.send(data)
	
	}
	
	})
	
	
	
	})
	app.get('/currenthour',cors(corsOptions),function(req,res){


		request.get({url:`https://www.yr.no/api/v0/locations/${req.query.place}/forecast/currenthour`,json:true},function(err,response,data){
		
		if(err){
		res.send('error')
		}else{
		
		let newdata = JSON.stringify(data)
		res.setHeader("Content-Type","application/json")
		res.send(newdata)
		
		}
		
		})
		
		
		
		})

	app.get('/place/query',cors(corsOptions),function(req,res){


		request.get({url:`https://www.yr.no/api/v0/locations/suggest?language=nb&q=${req.query.q}`,json:false},function(err,response,data){
		
		if(err){
		res.send('error')
		}else{
		
		
		res.send(data)
		
		}
		
		})
		
		
		
		})

app.get('/test', cors(corsOptions), function(req, res){
	var targetMoment =moment.utc()
     run(targetMoment)
});

app.get('/alive', cors(corsOptions), function(req, res){
	res.send('wind-js-server is alive');
});

app.get('/vasskraft', cors(corsOptions), function(req, res){
	res.send('VASSKRAFT BABY');
});
app.post('/vasskraft/firebaseIot', cors(corsOptions), express.json(), async function(req, res){

	try {
		var { data, resource, created } = req.body;
		
	
		
		let temp = resource.split("/")
		let customer = temp[temp.length -2]
		if(customer == "data"){
			customer = "lars_kraft"
		}

		const insertResult = await pool.query(
		  `INSERT INTO ${customer} (level, timestamp, voltage, sensor_type ,raw, timestamp_source,customer) VALUES ($1, $2, $3, $4, $5 ,$6, $7) RETURNING *`,
		  [data.sensor, created, data.voltage, "level" , data.raw, data.time, customer]
		);
	
		const insertedData = insertResult.rows[0];
		

		
		await influxDBClient.getWriteApi(influxDBConfig.org,influxDBConfig.bucket).writePoints([
			{
			  measurement: 'level', // Change this to your measurement name
			  fields: { voltage:data.voltage, level:data.sensor, raw:data.raw,timestamp_source:data.time,customer,created,sensor_type:'level' },
			  tags: { 'customer':customer,app:'vasskraft',data:data,id:10449793 },
			  timestamp: new Date(created), // Assuming 'created' is a valid timestamp
			},
		  ]);
	  
		res.json({ message: 'Sensor data inserted into the sensors_data table', insertedData });
	  } catch (error) {
		console.error('Error inserting sensor data into PostgreSQL:', error);
		res.status(500).send('Internal Server Error');
	  }

});

app.get('/getData', async (req, res) => {
	try {
	  const startTime = req.query.startTime; // Start time of the range
	  const endTime = req.query.endTime;
	  const customer = req.query.customer     // End time of the range
  
	  // Query to retrieve data within the specified time range
	  const query = `
		SELECT *
		FROM $3
		WHERE timestamp >= $1 AND timestamp <= $2;
	  `;
  
	  // Executing the query with parameters
	  const { rows } = await pool.query(query, [startTime, endTime,customer]);
  
	  // Sending the retrieved data as a response
	  res.json(rows);
	} catch (error) {
	  console.error('Error fetching data:', error);
	  res.status(500).json({ error: 'Error fetching data' });
	}
  });
  
 
 
 
  app.get('/getDataFromInfluxDB', async (req, res) => {
	try {
	  const period = req.body.period;
	  const aggregat = req.body.aggregat;
	  const customer = req.body.customer; // Measurement name
	  const startTime = req.body.startTime; // Start time of the range
	  const endTime = req.body.endTime; 
	  const field = req.body.field;     // End time of the range
		
	  // Flux query to retrieve data within the specified time range from the specified measurement
	  const filter = field ? `|> filter(fn: (r) => r["_field"] == "${field}")` : ''
	  const query = `
		from(bucket: "${influxDBConfig.bucket}")
		  |> range(start: ${startTime}, stop: ${endTime})
		  |> filter(fn: (r) => r["customer"] == "${customer}")`+
		  filter +
		  `|> aggregateWindow(every: ${period ? period:'1m'}, fn: ${aggregat ? aggregat : 'last'}, createEmpty: false)
	  `;

		
	//   // Executing the Flux query
	//   const fluxTable = await influxDBClient.getQueryApi(influxDBConfig.org).collectRows({ query });
	  
	//   // Sending the retrieved data as a response
	//   res.json(fluxTable);
	// } catch (error) {
	//   console.error('Error fetching data from InfluxDB:', error);
	//   res.status(500).json({ error: 'Error fetching data from InfluxDB' });
	// }
	let queryApi = influxDBClient.getQueryApi(influxDBConfig.org)
	let result = []
	queryApi.queryRows(query, {
		next: (row, tableMeta) => {
		  const tableObject = tableMeta.toObject(row);
		  result.push(tableObject)
		},
		error: (error) => {
		  res.status(500).send(error.message);
		},
		complete: () => {
		  res.json(result);
		  console.log("\nSuccess");
		},
	  });
	}catch(e){

		console.log(e)

	}
  });

app.post('/vasskraft/create', cors(corsOptions), express.json(), async function(req, res){

	try {
		var { data, resource, created } = req.body;
		
		
		let temp = resource.split("/")
		let customer = temp[temp.length -2]
		if(customer == "data"){
			customer = "lars_kraft"
		}

		const insertResult = await pool.query(
		  `INSERT INTO ${customer} (level, timestamp, voltage, sensor_type ,raw, timestamp_source,customer) VALUES ($1, $2, $3, $4, $5 ,$6, $7) RETURNING *`,
		  [data.sensor, created, data.voltage, "level" , data.raw, data.time, customer]
		);
	
		const insertedData = insertResult.rows[0];
		res.json({ message: 'Sensor data inserted into the sensors_data table', insertedData });
	  } catch (error) {
		console.error('Error inserting sensor data into PostgreSQL:', error);
		res.status(500).send('Internal Server Error');
	  }

});


app.get('/latest', cors(corsOptions), function(req, res){

	/**
	 * Find and return the latest available 6 hourly pre-parsed JSON data
	 *
	 * @param targetMoment {Object} UTC moment
	 */
	function sendLatest(targetMoment){

		var stamp = moment(targetMoment).format('YYYYMMDD')
		var fileName = __dirname +"/json-data/"+ stamp +".json";

		res.setHeader('Content-Type', 'application/json');
		res.sendFile(fileName, {}, function (err) {
			if (err) {
				console.log(stamp +' doesnt exist yet, trying previous interval..');
				sendLatest(moment(targetMoment).subtract(6, 'hours'));
			}
		});
	}

	sendLatest(moment().utc());

});
app.get('/transfer', async (req, res) => {
	try {
	  // Fetch data from PostgreSQL
	  const pgResult = await pool.query('SELECT * FROM lars_kraft');
	  const rows = pgResult.rows;
	  let writeApi =  influxDBClient.getWriteApi(influxDBConfig.org,influxDBConfig.bucket)
  
	  // Prepare and write points to InfluxDB
	  rows.forEach(row => {
		const point = new Point(req.query.measurement)
		  .tag('id',10449793 )
		  .floatField(req.query.field, row[req.query.field])
		  .timestamp(new Date(row.timestamp));
		  writeApi.writePoint(point);
	  });
  
	  await writeApi
		.close()
		.then(() => {
		  console.log('Finished writing to InfluxDB');
		})
		.catch(e => {
		  console.error(e);
		  console.log('Finished writing to InfluxDB with errors');
		});
  
	  res.send('Data transfer completed');
	} catch (error) {
	  console.error('Error transferring data:', error);
	  res.status(500).send('Error transferring data');
	}
  });


/**
 *
 * Ping for new data every 15 mins
 *
 */
setInterval(function(){

	run(moment.utc());

}, 900000);

/**
 *
 * @param targetMoment {Object} moment to check for new data
 */
function run(targetMoment){

	getGribData(targetMoment).then(function(response){
		if(response.stamp){
			convertGribToJson(response.stamp, response.targetMoment);
		}
	});
}

/**
 *
 * Finds and returns the latest 6 hourly GRIB2 data from NOAAA
 *
 * @returns {*|promise}
 */
function getGribData(targetMoment){

	var deferred = Q.defer();

	function runQuery(targetMoment){

        // only go 2 weeks deep
		if (moment.utc().diff(targetMoment, 'days') > 30){
	        console.log('hit limit, harvest complete or there is a big gap in data..');
            return;
        }

		

		var stamp = moment(targetMoment).format('YYYYMMDD')

		request.get({
			url: baseDir,
			qs: {
				file: 'gfs.t'+ roundHours(moment(targetMoment).hour(), 6) +'z.pgrb2.1p00.f000',
				lev_10_m_above_ground: 'on',
				lev_surface: 'on',
				var_UGRD: 'on',
				var_VGRD: 'on',
				leftlon: 0,
				rightlon: 360,
				toplat: 90,
				bottomlat: -90,
				dir: '/gfs.'+stamp+'/'+roundHours(moment(targetMoment).hour(), 6)+'/atmos'
			}

		}).on('error', function(err){
			console.log(err);
			runQuery(moment(targetMoment).subtract(6, 'hours'));

		}).on('response', function(response) {
			

			if(response.statusCode != 200){
				runQuery(moment(targetMoment).subtract(6, 'hours'));
			}

			else {
				// don't rewrite stamps
				if(!checkPath('json-data/'+ stamp +'.json', false)) {

					console.log('piping ' + stamp);

					// mk sure we've got somewhere to put output
					checkPath('grib-data', true);

					// pipe the file, resolve the valid time stamp
					var file = fs.createWriteStream("grib-data/"+stamp+".f000");
					response.pipe(file);
					file.on('finish', function() {
						file.close();
						deferred.resolve({stamp: stamp, targetMoment: targetMoment});
					});

				}
				else {
					console.log('already have '+ stamp +', not looking further');
					deferred.resolve({stamp: false, targetMoment: false});
				}
			}
		});

	
	}

	runQuery(targetMoment);
	return deferred.promise;
}

function convertGribToJson(stamp, targetMoment){

	// mk sure we've got somewhere to put output
	checkPath('json-data', true);

	var exec = require('child_process').exec, child;
	grib2json('grib-data/'+stamp+'.f000', {
		data: true,
		output: `json-data/${stamp}.json`
	  })
	  .then(function (json) {
		exec('rm grib-data/*');
		var prevMoment = moment(targetMoment).subtract(6, 'hours');
		var prevStamp = prevMoment.format('YYYYMMDD')

		if(!checkPath('json-data/'+ prevStamp +'.json', false)){

			console.log("attempting to harvest older data "+ stamp);
			run(prevMoment);
		}

		else {
			console.log('got older, no need to harvest further');
		}
		// Do whatever with the json data, same format as output of the CLI
	  })

	// child = exec(__dirname+'/converter/bin/grib2json --data --output json-data/'+stamp+'.json --names --compact grib-data/'+stamp+'.f000',
	// 	{maxBuffer: 500*1024},
	// 	function (error, stdout, stderr){

	// 		if(error){
	// 			console.log('exec error: ' + error);
	// 		}

	// 		else {
	// 			console.log("converted..");

	// 			// don't keep raw grib data
	// 			exec('rm grib-data/*');

	// 			// if we don't have older stamp, try and harvest one
	// 			var prevMoment = moment(targetMoment).subtract(6, 'hours');
	// 			var prevStamp = prevMoment.format('YYYYMMDD')

	// 			if(!checkPath('json-data/'+ prevStamp +'.json', false)){

	// 				console.log("attempting to harvest older data "+ stamp);
	// 				run(prevMoment);
	// 			}

	// 			else {
	// 				console.log('got older, no need to harvest further');
	// 			}
	// 		}
	// 	});
}
function convertGribToJson2(stamp, targetMoment){

	// mk sure we've got somewhere to put output
	checkPath('json-data', true);

	var exec = require('child_process').exec, child;
	grib2json('meps.grib', {
		data: true,
		output: 'json-data/output.json',
		bufferSize: 500*1024
	  })
	  .then(function (json) {
		// Do whatever with the json data, same format as output of the CLI
	  })
}

/**
 *
 * Round hours to expected interval, e.g. we're currently using 6 hourly interval
 * i.e. 00 || 06 || 12 || 18
 *
 * @param hours
 * @param interval
 * @returns {String}
 */
function roundHours(hours, interval){
	if(interval > 0){
		var result = (Math.floor(hours / interval) * interval);
		return result < 10 ? '0' + result.toString() : result;
	}
}

/**
 * Sync check if path or file exists
 *
 * @param path {string}
 * @param mkdir {boolean} create dir if doesn't exist
 * @returns {boolean}
 */
function checkPath(path, mkdir) {
    try {
	    fs.statSync(path);
	    return true;

    } catch(e) {
        if(mkdir){
	        fs.mkdirSync(path);
        }
	    return false;
    }
}

// init harvest
run(moment.utc());

module.exports = app;