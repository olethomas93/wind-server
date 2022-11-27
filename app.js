var express = require("express");
var bodyParser = require("body-parser");
var moment = require("moment");
var http = require('http');
var request = require('request');
var fs = require('fs');
var Q = require('q');
var cors = require('cors');
const grib2json = require('weacast-grib2json');
const { json } = require("express");

var app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
var port = process.env.PORT || 5000;
var host = process.env.HOST || 'localhost';
var baseDir ='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl';


// cors config
var whitelist = [
	'http://localhost:63342',
	'http://localhost:3000',
	'http://localhost:4000',
	'https://friliv.netlify.app',
	'https://friliv.northei.no'
];

var corsOptions = {
	origin: function(origin, callback){
		var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
		callback(null, originIsWhitelisted);
	}
};

app.listen(port, function(err){
	console.log("running server on port "+ port);
});

app.get('/', cors(corsOptions), function(req, res){
    res.send('hello wind-js-server.. go to /latest for wind data..');
});


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

app.get('/aurora/forecast',cors(corsOptions),function(req,res){


request.get({url:`https://www.yr.no/api/v0/locations/10-${req.query.placenumber}/auroraforecast?language=nb`,json:true},function(err,response,data){

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