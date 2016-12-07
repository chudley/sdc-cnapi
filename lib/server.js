/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var os = require('os');
var restify = require('restify');
var restifyValidator = require('restify-validator');
var tritonTracer = require('triton-tracer');
var formatJSON = require('restify/lib/formatters/json');

var endpoints = require('./endpoints/index');
var request_seq_id = 0;


function createServer(options) {
    var cnapi = restify.createServer({
        name: 'Compute Node API',
        log: options.log,
        handleUpgrades: true
    });

    cnapi.use(restify.requestLogger());

    // Start the tracing backend and instrument this restify 'server'.
    tritonTracer.instrumentRestifyServer({
        server: cnapi
    });

    cnapi.use(restify.acceptParser(cnapi.acceptable));
    cnapi.use(restify.authorizationParser());
    cnapi.use(restify.queryParser({
        mapParams: true,
        allowDots: false,
        plainObjects: false
    }));
    cnapi.use(restify.bodyParser());
    cnapi.use(restifyValidator);


    // Add a default timeout of one hour
    cnapi.use(function (req, res, next) {
        req.connection.setTimeout(3600 * 1000);
        res.connection.setTimeout(3600 * 1000);
        next();
    });

    var AUDIT_SKIP_ROUTES = {
        'ping': true,
        'servereventheartbeat': true,
        'servereventvmsupdate': true
    };
    cnapi.on('after', function (req, res, route, err) {
        if (req.route && AUDIT_SKIP_ROUTES[req.route.name]) {
            return;
        }

        // Successful GET res bodies are uninteresting and *big*.
        var body = req.method !== 'GET' &&
                   res.statusCode !== 404 &&
                   Math.floor(res.statusCode/100) !== 2;
        restify.auditLogger({
            log: req.log.child({ route: route && route.name }, true),
            body: body
        })(req, res, route, err);
    });

    cnapi.use(function (req, res, next) {
        res.on('header', function onHeader() {
            var now = Date.now();
            res.header('Date', new Date());
            res.header('Server', cnapi.name);
            res.header('x-request-id', req.getId());
            var t = now - req.time();
            res.header('x-response-time', t);
            res.header('x-server-name', os.hostname());
        });
        next();
    });

    cnapi.on('uncaughtException', function (req, res, route, err) {
        req.log.error(err);
        res.send(err);
    });

    endpoints.attachTo(cnapi, options.app);

    return cnapi;
}

exports.createServer = createServer;
