var url  = require('url');
var http = require('http');

function API(base_url) {
  this.base_url = url.parse(base_url);
}

API.prototype.start = function (key, job, options, callback) {
  var req = http.request({
    hostname : this.base_url.hostname,
    port     : this.base_url.port,
    path     : '/job/' + key + '?' + options.join('&'),
    method   : 'put',
    headers  : {
      'Content-Type': 'application/json'
    }
  }, function (res) {
    callback(null, res.statusCode, res);
  });
  req.on('error', callback);
  req.write(JSON.stringify(job));
  req.end();
};

API.prototype.stop = function (key, callback) {
  var req = http.request({
    hostname : this.base_url.hostname,
    port     : this.base_url.port,
    path     : '/job/' + key,
    method   : 'delete'
  });
  req.on('error', callback);
  req.end();
};

API.prototype.status = function (pkg, callback) {
  var req = http.request({
    hostname : this.base_url.hostname,
    port     : this.base_url.port,
    path     : '/job/' + pkg,
    method   : 'get'
  }, function (res) {
    var data = '';
    res.on('data', function (chunk) {
      data += chunk;
    });
    res.on('end', function () {
      var obj = JSON.parse(data);
      callback(null, obj);
    });
  });
  req.on('error', callback);
  req.end();
};

API.prototype.list = function (callback) {
  var req = http.request({
    hostname : this.base_url.hostname,
    port     : this.base_url.port,
    path     : '/jobs',
    method   : 'get'
  }, function (res) {
    var data = '';
    res.on('data', function (chunk) {
      data += chunk;
    });
    res.on('end', function () {
      var obj = JSON.parse(data);
      callback(null, obj);
    });
  });
  req.on('error', callback);
  req.end();
};

API.prototype.attach = function (pkg, callback) {
  var req = http.request({
    hostname : this.base_url.hostname,
    port     : this.base_url.port,
    path     : '/job/' + pkg + '/fd/1',
    method   : 'get'
  }, function (res) {
    callback(null, res);
  });
  req.on('error', callback);
  req.end();
};

module.exports = API;
