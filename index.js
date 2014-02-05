var http = require('http');
var net = require('net');
var registry = require('etcd-registry');
var pump = require('pump');

var router = function(cs, onroute) {
	if (typeof cs === 'function') return router(null, cs);

	var server = http.createServer();
	var services = registry(cs);

	var lookup = function(list, cb) {
		var i = 0;

		if (!list) return cb();
		if (!Array.isArray(list)) list = [list];
		if (!list.length) return cb();

		services.lookup(list[i++], function onservice(err, service) {
			if (err) return cb(err);
			if (service) return cb(null, service);
			if (i >= list.length) return cb();
			services.lookup(list[i++], onservice);
		});
	};

	var proxyConnection = function(request, socket, data, service) {
		server.emit('route', request, service);

		var proxy = net.connect(service.port, service.hostname);
		var head = request.method+' '+request.url+' HTTP/1.1\r\n';

		Object.keys(request.headers).forEach(function(key) {
			head += key+': '+request.headers[key]+'\r\n';
		});

		head += '\r\n';
		proxy.write(head);
		proxy.write(data);

		pump(socket, proxy, socket);
	};

	var proxyRequest = function(request, response, service) {
		server.emit('route', request, service);

		var req = http.request({
			method: request.method,
			headers: request.headers,
			path: request.url,
			hostname: service.hostname,
			port: service.port,
			agent: false
		});

		pump(request, req);
		req.on('response', function(res) {
			response.writeHead(res.statusCode, res.headers);
			pump(res, response);
		});
	};

	var onerror = function(response, statusCode, message) {
		response.statusCode = statusCode;
		response.end(message);
	};

	var onupgrade = function(request, socket, data) {
		onroute(request, function(list) {
			lookup(list, function(err, service) {
				if (err || !service) return socket.destroy();
				proxyConnection(request, socket, data, service);
			});
		});
	};

	server.on('connect', onupgrade);
	server.on('upgrade', onupgrade);

	server.on('request', function(request, response) {
		onroute(request, function(list) {
			lookup(list, function(err, service) {
				if (err) return onerror(response, 503, err.message.trim()+'\n');
				if (!service) return onerror(response, 404);
				proxyRequest(request, response, service);
			});
		});
	});

	return server;
};

module.exports = router;