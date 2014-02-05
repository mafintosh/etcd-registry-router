var router = require('./');
var http = require('http');
var registry = require('etcd-registry');

var services = 	registry();
var server = router(function(request, route) {
	route('http-worker');
});

server.on('route', function(request, service) {
	console.log('routing', (request.headers.host || '')+'/'+request.url, 'to', service.host, '('+service.name+')');
});

server.listen(8080);

var worker = http.createServer(function(request, response) {
	response.end('hello from worker\n');
});

worker.listen(0, function() {
	services.join('http-worker', {
		port: worker.address().port
	});
});