"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var _ = require('lodash');
var io = require('socket.io');
var ioWildcard = require('socketio-wildcard')();
var idHelper = require('../helpers/idHelper');
var Worker = require('../workers/Worker');
var SocketWorker = (function (_super) {
    __extends(SocketWorker, _super);
    function SocketWorker(opts) {
        _super.call(this, [
            'iw-http-server'
        ], {
            id: idHelper.newId(),
            name: 'iw-socket'
        }, opts);
        var defOpts = {};
        this.opts = this.opts.beAdoptedBy(defOpts, 'worker');
        this.opts.merge(opts);
    }
    SocketWorker.prototype.postInit = function (dependencies, callback) {
        var _this = this;
        this.socketServer = io(dependencies.list()[0].httpServer.listener);
        this.socketServer.use(ioWildcard);
        this.socketServer.on('connection', function (socket) {
            _this.monitorSocket(socket);
        });
        _super.prototype.postInit.call(this, dependencies, callback);
        return this;
    };
    SocketWorker.prototype.monitorSocket = function (socket) {
        var _this = this;
        socket.on('error', function (e) {
            _this.inform('error', e);
        });
        socket.on('*', function (event) {
            event.data.shift();
            var emit = _this.getCommEmit(event.data.shift());
            emit.scoc.push(_this.whoService);
            var anno = event.data.shift();
            if (_.isUndefined(anno) || anno === null) {
                anno = {};
            }
            event.data.push(anno);
            var cb = void 0;
            var callCb = _.any([
                'tell',
                'inform'
            ], function (m) {
                return emit.method === m;
            });
            if (callCb) {
                cb = event.data.pop();
            }
            if (!_.isUndefined(socket.iwAuth)) {
                _.set(anno, 'auth.authentication.authenticated', socket.iwAuth.authentication.authenticated);
                if (!_.isUndefined(socket.iwAuth.authorization)) {
                    var authorizationAnno = _.get(anno, 'auth.authorization');
                    if (_.isUndefined(authorizationAnno)) {
                        authorizationAnno = [];
                    }
                    else if (_.isObject(authorizationAnno)) {
                        authorizationAnno = [authorizationAnno];
                    }
                    var match = _.remove(authorizationAnno, function (authorization) {
                        return authorization.type === socket.iwAuth.authorization.type;
                    });
                    if (_.isUndefined(match)) {
                        authorizationAnno.push(socket.iwAuth.authorization);
                    }
                    authorizationAnno.push(socket.iwAuth.authorization);
                    _.set(anno, 'auth.authorization', authorizationAnno);
                }
            }
            _this[emit.method].apply(_this, [emit].concat(event.data));
            if (callCb) {
                cb();
            }
        });
    };
    SocketWorker.prototype.dispose = function (callback) {
        if (!_.isUndefined(this.socketServer)) {
            this.socketServer.close();
        }
        if (!_.isUndefined(callback)) {
            process.nextTick(function () {
                callback();
            });
        }
    };
    return SocketWorker;
}(Worker));
module.exports = SocketWorker;
//# sourceMappingURL=SocketWorker.js.map