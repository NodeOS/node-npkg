#!/usr/bin/env node

var os           = require('os');
var fs           = require('fs');
var pp           = require('path');
var http         = require('http');
var crypto       = require('crypto');
var spawn        = require('child_process').spawn;

var printf       = require('printf');
var optimist     = require('optimist');
var mkdirp       = require('lib-mkdirp');
var Config       = require('lib-config');
var Interp       = require('lib-interpolate');
var modinfo      = require('lib-modinfo');
var resolve      = require('lib-npkg-resolve');
var npaths       = require('lib-npkg-paths');
var cmdparse     = require('lib-cmdparse');

var npkghash     = require('./npkg-module-hash.js');
var API          = require('./api.js');

var argv         = optimist.argv;
var PORT         = process.env.PORT || 1;
var HOST         = process.env.HOST || '127.0.0.1';
var command      = process.argv[2];

var init_api     = new API('http://' + HOST + ':' + PORT);

var root         = process.env.HOME;
var node_modules = pp.join(root,'lib/node_modules');

var CONFIG_ROOT  = process.env.HOME + '/etc';

var http_request;
if (process.env.DEBUG) {
  var stream = require('stream');
  http_request = function (opts, callback) {
    console.log('----> HTTP Request <----')
    console.log(opts);
    var buf = ""
    return {
      write: function (d){ buf += d },
      on: function (){},
      end: function () {
        console.log(JSON.parse(buf));
      }
    }
  };
} else {
  http_request = http.request;
}

// try to load a file, and parse it into an object
// if that fails, just return an empty object
// this shouldn't throw an error
// it's a big boy, it deals with it's own problems
function graceful(file) {
  var config;
  try {
    config = JSON.parse(
      fs.readFileSync(file, 'utf-8')
    );
  } catch (e) {
    // default empty config
    config = {};
  }
  return config;
}

function mappings (pkg, root) {
  return {
    home     : process.env.HOME,
    user     : process.env.USER,
    root     : root,
    package  : pkg,
    path     : process.env.PATH,
    hostname : os.hostname(),
    tmpdir   : os.tmpdir()
  };
};

function Controller(){
  
}

// is a module relative or global
// global modules are refered to by name
// relative modules are refered to with an
// absolute path, or path starting with ./
function is_relative(pth) {
  return (pth[0] === '.' || pth[0] === '/');
}

var YES = '\033[36mYes\033[0m';
var NO  = '\033[92mNo\033[0m ';

Controller.prototype.show = function () {
  if (argv.start && argv.bin) return console.log('Cannot specify --start and --bin together');

  if (!argv.start && !argv.bin) 
    console.log("\033[1mPackage              Has bin     Can start   Has test\033[0m");

  var node_modules = npaths('node_modules');

  fs.readdirSync(node_modules).forEach(function (name) {

    var pkg  = pp.join(node_modules, name);
    var info = modinfo(pkg);

    var temp = "%-20s %-20s %-20s %-10s";
    var bin  = info.bin                           ? YES : NO;
    var strt = info.scripts && info.scripts.start ? YES : NO;
    var test = info.scripts && info.scripts.test  ? YES : NO;

    var line = printf(temp, name, bin, strt, test);

    if (argv.start) {
      if (info.scripts && info.scripts.start) console.log(name);
      return;
    } else if (argv.bin) {
      if (info.bin) console.log(name);
      return;
    } else {
      return console.log(line);
    }
  });
};

function generateRunParameters(pkg) {
  // --
  // -- load environment
  // --

  var config   = new Config();
  var pkg_path = resolve(pkg);

  // first thing to do is determine if this is a relative
  // module, or an global module
  //
  // relative modules are *always* started with current
  // environment variables
  //
  // global modules are started with environment values
  // defined in $HOME/etc/$PKG/defaults.json
  //
  if (is_relative(pkg)) {
    // this is a relative module

    // we write logs to the current directory
    config.load({
      // set expected service variables to current directory
      // this is principle of least surprise, you shouldn't 
      // have to go searching the system for these directories
      "VARDIR"  : process.cwd(),
      "LOGDIR"  : process.cwd(),
      "TEMPDIR" : process.cwd()
    });

    // relative modules inherit the calling processes
    // the environment can override any of the above defaults
    config.load(process.env);

    // finally ammend the path to include execs defined in
    // dependent modules
    config.load({
      "PATH" : "%{root}/node_modules/.bin : %{path}",
    });
  } else {
    // this is a global module

    // load the default config first
    // the package specific config can override default values
    var config_defaults = npaths('config_defaults')
    var module_defaults = npaths('config_defaults_module', {package: pkg})

    config.load(graceful(config_defaults));
    config.load(graceful(module_defaults));
  }

  // grab package.json file
  var info  = modinfo(pkg_path);
  var start = info && info.scripts && info.scripts.start;
  if (!start)
    throw new Error('Package %s has no start script', pkg);

  // parse start script
  var cmds = cmdparse(start);
  var exec = cmds.exec;
  var args = cmds.args;

  // add any environment variables defined in the start script
  config.load(cmds.envs);

  // interpolated values for the environment variables
  // each value is expanded wherever %{VAR} is found
  // e.g. %{home} --> /home/jacob
  //      %{user} --> jacob
  var map    = mappings(pkg, pkg_path);
  var interp = new Interp(map);

  // envs will hold the environment variables of our job
  var envs = {};
  config.keys().forEach(function (key) {
    // get the config value and interpolate it
    // against the above map
    envs[key] = interp.expand(config.get(key));
  });

  // make sure some directories exist
  // part of the package/init contract is that 
  // a temp and var directory are available
  // this seems like as good a time as any to 
  // ensure these directories are here
  if (envs.VARDIR ) mkdirp(envs.VARDIR);
  if (envs.TEMPDIR) mkdirp(envs.TEMPDIR);
  if (envs.LOGDIR ) mkdirp(envs.LOGDIR);
    
  // job stanza to be serialized as the request body
  var job = {
    exec : exec,
    args : args,
    cwd  : pkg_path,
    env  : envs
  };

  // everything necessary to start your day
  return job;
}

Controller.prototype.run = function (pkg) {
  if (!pkg) throw new Error('Run what (try: npkg show)?');

  var run = generateRunParameters(pkg);

  // run the job as a child process
  // attach current stdio to child
  var proc = spawn(run.exec, run.args, run);
  
  process.stdin.pipe(proc.stdin);
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);
  
  proc.on('exit', function (code, signal) {
    // exit with childs status code
    // or exit 51 in the event of a signal
    // because 51gnal looks like Signal
    process.exit(code === null ? 51 : code)
  });
};

Controller.prototype.start = function(pkg){
  if (!pkg) return console.log('Start what?');

  var run = generateRunParameters(pkg);
  var key = npkghash(pkg);

  var log = pp.join(run.env.LOGDIR, key + '.log');

  // job stanza to be serialized as the request body
  var job = {
    exec  : run.exec,
    args  : run.args,
    cwd   : run.cwd,
    env   : run.env,
    stdio : {
      // we log to the logs directory
      // currently now ay to provide a stdin
      stdout: log,
      stderr: log
    }
  };

  // job options
  var options = [];

  if (argv.attach) {
    // debugging services is a pain in the ass, so we
    // stream the contents back to npkg
    // you can ^C at any time to stop receiving output
    // this in no way affects the job
    options.push('stdio=stream');
  }

  function handle_response(err, res) {
    if (err) return console.log('Error', err);

    switch(res.statusCode) {
      case 400:
        console.log('Failed to Start Service');
        break;
      case 201:
        console.log('Started Service');
        break;
      default:
        console.log('Unknown Response');
    }

    // res.pipe(process.stdout);
    res.pipe(process.stdout);
    res.on('end', function () {
      console.log();
      console.log('started : %s', key);
      console.log('logfile : %s', log);
    });
  }

  init_api.start(key, job, options, handle_response);
};

Controller.prototype.stop = function(pkg){
  init_api.stop(pkg, function (err) {
    if (err) console.log('Error', err);
  });
};

Controller.prototype.attach = function(pkg){
  init_api.attach(pkg, function (err, str) {
    if (err) return console.log('Error', err);
    str.pipe(process.stdout);
  });
};

Controller.prototype.ls   =
Controller.prototype.list = function () {
  init_api.list(function (err, obj) {
    Object.keys(obj).forEach(function (name) {
      var job = obj[name];
      var msg = printf("%-20s %-10s %-10s %-10s", name, job.status, job.pid, job.respawn);
      console.log(msg);
    });
  });
};

Controller.prototype.st     =
Controller.prototype.stat   =
Controller.prototype.status = function (pkg) {
  if (!pkg) return console.log('Which Status?\nTry `npkg list`');
  init_api.status(pkg, function (err, obj) {
    if (err) return console.log('Error', err);
    console.log(JSON.stringify(obj, null, 2));
  });
};

// parse an npmrc file into an object
function config(path){
  var configs = {};
  try {
    var f = fs.readFileSync(path);  
    f.trim().split(/\n/).forEach(function (line) {
      var split = line.trim().split(/\s*=\s*/);
      if(split.length<2) return;
      configs[split[0]] = configs[split[1]];
    });
  } catch (e) {
    // nothing
  }
  return configs;
}

Controller.prototype.i = 
Controller.prototype.install = function(arg){

  if (!arg) return console.log('Install what?');

  var npm    = require('npm');
  var home   = process.env.HOME;
  var prefix = pp.join(home);
  npm.load({
    prefix: prefix
  },function(err){
    if(err) return console.log("Error",err);
    npm.config.set('global',true);
    var conf = config(process.env.HOME + '/.npmrc');
    for(var key in conf) {
      npm.config.set(key, conf[key]);
    }
    npm.commands.install(arg, function(err){
      if(err) {
        console.log(err);
        process.exit(-1);
      }

      // totally unsafe way to grab package.json
      // i don't really mind blowing up here, it would be weird
      // if package.json diesn't exist, or was incorrect
      var pkg_json = JSON.parse(
        fs.readFileSync(
          pp.join(root, 'lib/node_modules', arg, 'package.json'), 'utf-8'
        )
      );

      var pkg_config_dir  = pp.join(process.env.HOME, 'etc', arg);
      var pkg_config_file = pp.join(pkg_config_dir, 'defaults.json');

      var envs;
      var config = graceful(pkg_config_file);

      // setup environment properties
      // add them to the config file on install
      if (envs = pkg_json.environment) {
        Object.keys(envs).forEach(function (key) {
          if (!config[key]) config[key] = null;
        });
      }

      // if all goes well, we create an empty config file
      // in $HOME/etc/$PACKAGE/defaults.json
      mkdirp(pkg_config_dir);
      
      fs.writeFileSync(pkg_config_file, JSON.stringify(config));
    });
  });
};

Controller.prototype.remove = function(){
  console.log('(Not Yet Implemented)');
};

var controller = new Controller();

Controller.prototype.c      =
Controller.prototype.cfg    =
Controller.prototype.config = function () {
  var subcmd = argv._[1];
  var key    = argv._[2];
  var val    = argv._[3];
  var name   = argv.name || argv.n;

  // the config file can either come from the default,
  // $HOME/etc/defaults.json or a package-specific location
  // $HOME/etc/$PKG/defaults.json
  // either way, we keep our stories straight here
  var cfg_path;
  var cfg_dir = CONFIG_ROOT;
  if (name) cfg_dir += '/' + name;
  cfg_path = cfg_dir + '/defaults.json';
  var config = graceful(cfg_path);

  function cfg_usage() {
    console.log("Usage: npkg config [OPTS] get KEY          get a config value");
    console.log("       npkg config [OPTS] set KEY=VAL      set a config value");
    console.log("       npkg config [OPTS] rm KEY           remove config value");
    console.log("       npkg config [OPTS] list             list all config keys");
    console.log("       npkg config [OPTS] cat              list all key=value pairs");
    console.log("       npkg config [OPTS] gen KEY          interpolate a config");
    console.log("");
    console.log("       OPTIONS");
    console.log("");
    console.log("       --name=NAME/-n NAME   name of package (or default)");
    console.log("");
    process.exit(1);
  }

  function cfg_fmt(obj) {
    Object.keys(obj).forEach(function (key) {
      console.log('%s=%s', key, obj[key]);
    });
  }

  // the config option has subcommands
  // basically a CRUD for config settings
  switch (subcmd) {
    case 'g':
    case 'get':
      if (!key) return cfg_usage();
      if (config[key]===undefined) console.log('');
      else console.log(config[key]);
      break;
    case 's':
    case 'set':
      if (!key) return cfg_usage();
      mkdirp(cfg_dir);

      // let the user also use KEY=VAL style
      // e.g. npkg config set NAME=jacob
      if (!val) {
        var _split = key.split('=');
        key = _split[0];
        val = _split[1];
      }

      config[key] = val;
      fs.writeFileSync(cfg_path, JSON.stringify(config), 'utf-8');
      break;
    case 'c':
    case 'cat':
      cfg_fmt(config);
      break;
    case 'l':
    case 'ls':
    case 'list':
      Object.keys(config).forEach(function (key) {
        console.log(key);
      });
      break;
    case 'gen':
    case 'generate':
      if (!key) return cfg_usage();

      // generate a configuration, interpolating any missing parameters
      // right now this isn't going to generate the same thing as npkg start
      // but we are working on that
      var pkg = key;
      var config = new Config();

      // first thing to do is determine if this is a relative
      // module, or an global module
      //
      // relative modules are *always* started with current
      // environment variables
      //
      // global modules are started with environment values
      // defined in $HOME/etc/$PKG/defaults.json
      //
      var pkg_path;
      var is_rel;

      // this is a relative module
      if (is_rel = is_relative(pkg)) {
        pkg_path = pp.resolve(process.cwd(), pkg);
        config.load(process.env);

        // We leave the environment un-touched,
        // except we make sure the node_modules/.bin
        // directory is in the PATH and accssible to the module.
        // To do otherwise would encourage strange behaviour
        //
        // we write logs to the current directory
        config.load({
          "PATH"   : "%{root}/node_modules/.bin : %{path}",
          "LOGDIR" : process.cwd()
        });
      }

      // this is a global module
      else {
        console.log()
        pkg_path = pp.join(node_modules, pkg);

        // load the default config first
        // the package specific config can override default values
        config.load(graceful(npaths('config_defaults')));
        config.load(graceful(npaths('config_defaults_module', {package: pkg})));
      }

      // interpolated values for the environment variables
      // each value is expanded wherever %{VAR} is found
      // e.g. %{home} --> /home/jacob
      //      %{user} --> jacob
      var map    = mappings(root, pkg_path);
      var interp = new Interp(map);
      config.keys().forEach(function (key) {
        var str = config.get(key);
        console.log("%s=%s", key, interp.expand(str));
      });
      break;
    case 'rm':
    case 'remove':
      delete config[key];
      fs.writeFileSync(cfg_path, JSON.stringify(config), 'utf-8');
      break;
    default:
      cfg_usage();
  }
}

if(controller[command]){
  var target = process.argv[3];
  if (command) controller[command](target);
  else console.log('Please Specify Target');
}else{
  fs.createReadStream(__dirname + "/usage.txt").pipe(process.stdout);
}
