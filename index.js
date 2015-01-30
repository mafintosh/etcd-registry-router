var http = require('http');
var net = require('net');
var registry = require('etcd-registry');
var pump = require('pump');

var noop = function() {};

var wrap = function(fn) {
	return function(request, response, route) {
		fn(request, route);
	};
};

var router = function(cs, onroute) {
	if (typeof cs === 'function') return router(null, cs);

	var server = http.createServer();
	var services = typeof cs === 'object' && cs ? cs : registry(cs);

	if (onroute.length === 2) onroute = wrap(onroute);

	var lookup = function(list, cb) {
		var i = 0;

		if (!list) return cb();
		if (typeof list === 'object' && list.hostname && list.port) return cb(null, list);
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
		request.emit('route', service);
		delete request.headers.connection; // fixes ECONNRESET issue

		var req = http.request({
			method: request.method,
			headers: request.headers,
			path: request.url,
			hostname: service.hostname,
			port: service.port,
			agent: false
		});

		pump(request, req);
		req.on('error', function() {
			request.destroy();
		});
		req.on('response', function(res) {
			response.writeHead(res.statusCode, res.headers);
			pump(res, response);
		});
	};

	var destroyer = function(socket) {
		return function(err, service) {
			if (!service) socket.destroy();
		};
	};

	var onupgrade = function(request, socket, data) {
		socket.on('error', noop);
		onroute(request, socket, function(list, cb) {
			if (!cb) cb = destroyer(socket);
			if (!socket.readable) return cb(new Error('socket is closed'));
			lookup(list, function(err, service) {
				if (!socket.readable) return cb(new Error('socket is closed'));
				if (err || !service) return cb(err);
				proxyConnection(request, socket, data, service);
				cb(null, service);
			});
		});
	};

	server.on('connect', onupgrade);
	server.on('upgrade', onupgrade);

	server.on('request', function(request, response) {
		onroute(request, response, function(list, cb) {
			if (!cb) cb = destroyer(request);
			lookup(list, function(err, service) {
				if (err || !service) return cb(err);
				proxyRequest(request, response, service);
				cb(null, service);
			});
		});
	});

	return server;
};

module.exports = router;