#!/usr/bin/env node

var os           = require('os');
var fs           = require('fs');
var pp           = require('path');
var util         = require('util');
var spawn        = require('child_process').spawn;

var printf       = require('printf');
var optimist     = require('optimist');
var mkdirp       = require('lib-mkdirp');
var Config       = require('lib-config');
var Interp       = require('lib-interpolate');
var resolve      = require('lib-npkg-resolve');
var cmdparse     = require('lib-cmdparse');

var npkghash     = require('./npkg-module-hash.js');
var graceful     = require('./lib-graceful-json.js');
var NPKGConfig   = require('./lib-npkg-config.js');
var npaths       = require('./lib-npkg-paths.js');
var modinfo      = require('./lib-modinfo.js');
var fmtenvs      = require('./lib-format-envs.js');

var API          = require('./api.js');

var argv         = optimist.argv;
var PORT         = process.env.NPKG_PORT || process.env.PORT || 1;
var HOST         = process.env.NPKG_BIND || process.env.BIND || '127.0.0.1';
var command      = process.argv[2];

var init_api     = new API('http://' + HOST + ':' + PORT);

var root         = process.env.HOME;

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
}

function Controller(){
  //
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
  var node_modules = npaths('node_modules');

  console.log("\033[1mPackage              Has bin     Can start   Has test\033[0m");

  fs.readdirSync(node_modules).forEach(function (name) {

    var pkg  = pp.join(node_modules, name);
    var info = modinfo(pkg);

    var temp = "%-20s %-20s %-20s %-10s";
    var bin  = info.bin                           ? YES : NO;
    var strt = info.scripts && info.scripts.start ? YES : NO;
    var test = info.scripts && info.scripts.test  ? YES : NO;

    var line = printf(temp, name, bin, strt, test);

    console.log(line);
  });
};

function generateRunParameters(pkg) {
  // --
  // -- load environment
  // --

  var config   = new Config();

  // determine the full path of the npkg package
  // this lookup is not the same as regular module lookup
  // relative paths start from process.cwd()
  // global names start from $HOME/lib/node_modules
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
    var config_defaults = npaths('config_defaults');
    var module_defaults = npaths('config_defaults_module', {package: pkg});

    config.load(graceful(config_defaults));
    config.load(graceful(module_defaults));
  }

  // grab package.json file
  var info  = modinfo(pkg_path);
  var start = info && info.scripts && info.scripts.start;
  if (!start) {
    var msg = util.format('Package %s has no start script', pkg);
    throw new Error(msg);
  }

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

  proc.on('exit', function (code) {
    // exit with childs status code
    // or exit 51 in the event of a signal
    // because 51gnal looks like Signal
    process.exit(code === null ? 51 : code);
  });
};

Controller.prototype.start = function(pkg){
  if (!pkg) return console.log('Start what?');

  var run = generateRunParameters(pkg);
  var key = npkghash(pkg);

  // we're going to tell init where to write stdout/stderr
  // right now, we're going to write to within the LOGDIR or
  // failing that, to the current directory
  var logdir = run.env.LOGDIR || process.cwd();
  var log = npaths('service_log_file', {
    logdir : logdir,
    key    : key
  });

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

  function handle_response(err, status, str) {
    if (err) return console.log('Error', err);

    switch(status) {
      case 400:
        console.log('Failed to Start Service');
        break;
      case 201:
        console.log('Started Service');
        break;
      default:
        console.log('Unknown Response');
    }

      // str.pipe(process.stdout);
    str.pipe(process.stdout);
    str.on('end', function () {
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
    if (err) return console.log(err);
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
    Object.keys(conf).forEach(function (key) {
      npm.config.set(key, conf[key]);
    });
    npm.commands.install(arg, function(err){
      if(err) {
        console.log(err);
        process.exit(-1);
      }
    });
  });
};

Controller.prototype.remove = function(){
  console.log('(Not Yet Implemented)');
};

function cfg_usage() {
  fs.createReadStream(__dirname + '/usage-config.txt', 'utf-8').pipe(process.stdout);
}

var controller = new Controller();

Controller.prototype.c      =
Controller.prototype.cfg    =
Controller.prototype.config = function () {
  var subcmd  = argv._[1];
  var key     = argv._[2];
  var val     = argv._[3];
  var name    = argv.name || argv.n;

  var defpath;
  if (name) {
    defpath = npaths('config_defaults_module', {package: name});
  } else {
    defpath = npaths('config_defaults');
  }

  var npkgcfg = NPKGConfig.Load(defpath);

  // the config option has subcommands
  // basically a CRUD for config settings
  switch (subcmd) {
    case 'g':
    case 'get':
      if (!key) throw new Error('Please Specify KEY');
      console.log(npkgcfg.get(key));
      break;

    case 's':
    case 'set':
      if (!key) throw new Error('Please Specify KEY=VALUE');

      // let the user also use KEY=VAL style
      // e.g. npkg config set NAME=jacob
      if (!val) {
        var _split = key.split('=');
        key = _split[0];
        val = _split[1];
      }

      npkgcfg.set(key, val);
      NPKGConfig.Save(defpath, npkgcfg);
      break;

    case 'c':
    case 'cat':
      npkgcfg.cat().pipe(process.stdout);
      break;

    case 'l':
    case 'ls':
    case 'list':
      npkgcfg.list().pipe(process.stdout);
      break;

    case 'gen':
    case 'generate':
      if (!key) throw new Error('Please Specify PACKAGE');

      var run = generateRunParameters(key);

      fmtenvs(run.env).pipe(process.stdout);
      break;

    case 'rm':
    case 'remove':
      npkgcfg.remove(key);
      NPKGConfig.Save(defpath, npkgcfg);
      break;

    default:
      cfg_usage();
  }
};

if(controller[command]){
  var target = argv._[1];
  try {
    if (command) controller[command](target);
    else console.log('Please Specify Target');
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
} else {
  var usage = fs.createReadStream(__dirname + "/usage.txt");
  usage.on('end', function () {
    // printing usage is an error, unless you specifically asked for it
    if (!argv.help) process.exit(2);
  });
  usage.pipe(process.stdout);
}
