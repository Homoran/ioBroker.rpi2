/**
 *      RPI-Monitor Adapter
 *
 *      License: MIT
 */

var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

var adapter = utils.adapter({
    name: 'rpi',

    ready: function () {
        if (adapter.config.forceinit) {
            adapter.objects.getObjectList({startkey: adapter.name + '.' + adapter.instance, endkey: adapter.name + '.' + adapter.instance + '\u9999'}, function (err, res) {
                res = res.rows;
                for (var i = 0; i < res.length; i++) {
                    var id = res[i].doc.common.name;

                    adapter.log.debug('Remove ' + id + ': ' + id);

                    adapter.delObject(id, function (res, err) {
                        if (res !== undefined && res != "Not exists") adapter.log.error("res from delObject: " + res);
                        if (err !== undefined) adapter.log.error("err from delObject: " + err);
                    });
                    adapter.deleteState(id, function (res, err) {
                        if (res !== undefined && res != "Not exists") adapter.log.error("res from deleteState: " + res);
                        if (err !== undefined) adapter.log.error("err from deleteState: " + err);
                    });
                }
            });
        }
        adapter.subscribeObjects('*');
        adapter.subscribeStates('*');

        adapter.objects.getObjectList({include_docs: true}, function (err, res) {
            res = res.rows;
            objects = {};
            for (var i = 0; i < res.length; i++) {
                objects[res[i].doc._id] = res[i].doc;
            }

            adapter.log.debug('received all objects');
            main();
        });
    },
    objectChange: function (id, obj) {
        adapter.log.debug("objectChange for " + id + " found, obj = " + JSON.stringify(obj));
    },
    stateChange: function (id, state) {
        adapter.log.debug("stateChange for " + id + " found state = " + JSON.stringify(state));
    },
    unload: function (callback) {
        callback();
    },
});

var objects;
var rpi     = {};
var table   = {};
var exec;
var config  = adapter.config;
var oldstyle = false;

function main() {
    // TODO: Check which Objects we provide
    setInterval(parser, adapter.config.interval || 60000);

    var version = process.version
    var va = version.split(".");
    if (va[0] == "v0" && va[1] == "10") {
        adapter.log.debug("NODE Version = " + version + ", we need new exec-sync");
        exec    = require('sync-exec');
        oldstyle = true;
    } else {
        adapter.log.debug("NODE Version = " + version + ", we need new execSync");
        exec    = require('child_process').execSync;
    }
    parser();
}

function parser() {

    adapter.log.debug("start parsing");

    // Workaround, WebStorm
    if (config == undefined) {
        config = adapter.config;
    }
    for (var c in config) {
        adapter.log.debug("PARSING: " + c);

        if (c.indexOf("c_") !== 0 && config["c_" + c] === true) {
            table[c] = new Array(20);
            var o = config[c];
            for (var i in o) {
                adapter.log.debug("    PARSING: " + i);
                var object = o[i];
                var command = object.command;
                var regexp;
                if (object.multiline !== undefined) {
                    regexp = new RegExp(object.regexp, 'm');
                } else {
                    regexp = new RegExp(object.regexp);
                }
                var post = object.post;

                adapter.log.debug("---> " + command);

                var stdout;
                try {
                    if (oldstyle) {
                        stdout = exec(command).stdout;
                    } else {
                        stdout = exec(command).toString();
                    }
                    adapter.log.debug("------------- " + stdout);
                } catch (er) {
                    adapter.log.debug(er.stack);
                    if (er.pid) console.log('%s (pid: %d) exited with status %d',
                        er.file, er.pid, er.status);
                    // do not process if exec fails 
                    continue;
                }

                var match = regexp.exec(stdout);
                adapter.log.debug("---> REGEXP: " + regexp);
                if (match !== undefined && match !== null && match.length !== undefined) {
                    adapter.log.debug("GROUPS:" + match.length);
                }
                // TODO: if Group Match is bigger then 2
                // split groups and header into seperate objects
                if (match !== undefined && match !== null && match.length > 2) {
                    var lname = i.split(",");
                    for (var m = 1; m < match.length; m++) {
                        var value = match[m];
                        var name = lname[m - 1];
                        adapter.log.debug("MATCHING:" + value);
                        adapter.log.debug("NAME: " + name + " VALULE:" + value);

                        rpi[name] = value;
                        table[c][i] = value;
                    }
                } else {
                    adapter.log.debug("---> POST:   " + post);
                    var value;
                    if (match !== undefined && match !== null) {
                        value = match[1];
                    } else {
                        value = stdout;
                    }
                    rpi[i] = value;
                    table[c][i] = value;
                }
            }
        }
    }

    // TODO: Parse twice to get post data and evaluate
    for (c in config) {
        adapter.log.debug("CURRENT = " + c + " " + config["c_" + c]);
        adapter.log.debug(c.indexOf("c_"));
        if (c.indexOf("c_") !== 0 && config["c_" + c]) {
            if (objects[c] === undefined) {
                var stateObj = {
                    common: {
                        name:   c, // You can add here some description
                        read:   true,
                        write:  true,
                        role:   'sensor'
                    },
                    type:   'device',
                    _id:    c
                };

                adapter.extendObject(c, stateObj);
            }
            var o = config[c];
            for (var i in o) {
                var object = o[i];
                var command = object.command;
                var post = object.post;

                adapter.log.debug("---> POST:   " + post + " for " + i + " in " + o);
                var value;

                var lname = i.split(",");
                if (lname !== undefined && lname.length > 1) {
                    for (var m = 0; m < lname.length; m++) {
                        var name = lname[m];
                        value = rpi[name];

                        // TODO: Check if value is number and format it 2 Digits
                        if (!isNaN(value)) {
                            value = parseFloat(value);
                            var r = new RegExp(/^\d+\.\d+$/);
                            if (r.exec(value)) {
                                value = value.toFixed(2);
                            }
                        }

                        adapter.log.debug("MATCHING:" + value);
                        adapter.log.debug("NAME: " + name + " VALULE:" + value);

                        var objectName = adapter.name + "." + adapter.instance + "." + c + "." + name;
                        adapter.log.debug("SETSTATE FOR " + objectName + " VALUE = " + value);
                        if (objects[objectName] === undefined) {
                            // TODO Create an Objecttree
                            var stateObj = {
                                common: {
                                    name: objectName, // You can add here some description
                                    read: true,
                                    write: true,
                                    state: "mixed",
                                    role: 'value',
                                    type: 'number'
                                },
                                type: 'state',
                                _id: objectName
                            };
                            adapter.extendObject(objectName, stateObj);
                        }
                        adapter.setState(objectName, {
                            val: value,
                            ack: true
                        });
                    }
                } else {
                    value = rpi[i];
                    if (value !== undefined && value !== "" && value !== null) {
                        if (post.indexOf('$1') !== -1) {
                            adapter.log.debug("VALUE: " + value + " POST: " + post);
                            value = eval(post.replace('$1', value));
                        }
                        // TODO: Check if value is number and format it 2 Digits
                        if (!isNaN(value)) {
                            value = parseFloat(value);
                            var r = new RegExp(/^\d+\.\d+$/);
                            if (r.exec(value)) {
                                value = value.toFixed(2);
                            }
                        }

                        var objectName = adapter.name + "." + adapter.instance + "." + c + "." + i;
                        adapter.log.debug("SETSTATE FOR " + objectName + " VALUE = " + value);
                        if (objects[objectName] === undefined) {
                            // TODO Create an Objecttree
                            var stateObj = {
                                common: {
                                    name: objectName, // You can add here some description
                                    read: true,
                                    write: true,
                                    state: "mixed",
                                    role: 'value',
                                    type: 'mixed'
                                },
                                type: 'state',
                                _id: objectName
                            };
                            adapter.extendObject(objectName, stateObj);
                        }
                        adapter.setState(objectName, {
                            val: value,
                            ack: true
                        });
                    } else {
                        adapter.log.error("No Value found for " + i);
                    }
                }
            }
        }
    }
}
