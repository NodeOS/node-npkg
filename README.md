# node-os package manager

The node-os uses npm for package management, 
but the `npm` command is not sufficient for proper installation of node-os packages. 

The `npkg` command handles all os-related package management.
If you're writing a node.js app, you will still use the `npm` command locally.

## usage

```
Usage: npkg COMMAND TARGET

  Commands

    install            install package TARGET from npm
    run                run a package in the foreground
    show               list installed packages
    
    start              start package TARGET via init
    stop               stop running package TARGET via init
    list               list active jobs
    status             list an active jobs status
    
    config             manipulate config from command line
    
  Environment    
    
    NPKG_PORT/PORT     the port used to connect to init (Default 1)
    NPKG_BIND/BIND     the address init has bound to (Default localhost)

```

## executables

```bash
$ npkg install wssh
$ wssh 192.168.0.123
```

## services

```bash
$ npkg install wssh
$ npkg start wssh
```
