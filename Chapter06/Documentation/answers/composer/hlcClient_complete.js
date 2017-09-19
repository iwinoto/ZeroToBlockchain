/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


'use strict';
var fs = require('fs');
var path = require('path');
const BusinessNetworkConnection = require('composer-client').BusinessNetworkConnection;
const config = require('../../../env.json');
const NS = 'org.acme.Z2BTestNetwork';
let itemTable = null;
const svc = require('./Z2B_Services');
const util = require('./Z2B_Utilities');

/**
 * get orders for buyer with ID =  _id
 * @param {express.req} req - the inbound request object from the client
 *  req.body.id - the id of the buyer making the request
 *  req.body.userID - the user id of the buyer in the identity table making this request
 *  req.body.secret - the pw of this user. 
 * @param {express.res} res - the outbound response object for communicating back to client
 * @param {express.next} next - an express service to enable post processing prior to responding to the client
 * returns an array of assets
 * @function
 */
exports.getMyOrders = function (req, res, next) {
    // connect to the network
    let newFile = path.join(path.dirname(require.main.filename),'network','package.json');
    let packageJSON = JSON.parse(fs.readFileSync(newFile));
    let allOrders = new Array();
    let businessNetworkConnection;
    let factory;
    let serializer;
    businessNetworkConnection = new BusinessNetworkConnection();
    return businessNetworkConnection.connect(config.composer.connectionProfile, config.composer.network, req.body.userID, req.body.secret)
        .then(() => {    
            return businessNetworkConnection.query('selectOrders')
            .then((orders) => {
                    let jsn;
                    let allOrders = new Array();
                    for (let each in orders)
                        { (function (_idx, _arr)
                            { 
                                let _jsn = svc.getOrderData(_arr[_idx]);
                                _jsn.id = _arr[_idx].orderNumber;
                                allOrders.push(_jsn);                                
                            })(each, orders)
                        }
                    res.send({'result': 'success', 'orders': allOrders});
                    })
                    .catch((error) => {console.log('selectOrders failed ', error); })
                    res.send({'result': 'failed', 'error': 'selectOrders: '+error.message});;
                })
            .catch((error) => {console.log('businessNetwork connect failed ', error); })
            res.send({'result': 'failed', 'error': 'businessNetwork: '+error.message});;
            }

/**
 * return a json object built from the item table created by the autoload function
 * @param {express.req} req - the inbound request object from the client
 * @param {express.res} res - the outbound response object for communicating back to client
 * @param {express.next} next - an express service to enable post processing prior to responding to the client
 * returns an array of assets
 * @function
 */
exports.getItemTable = function (req, res, next)
{
    if (itemTable == null)
    {
        let options = { flag : 'w' };
        let newFile = path.join(path.dirname(require.main.filename),'startup','itemList.txt');
        itemTable = JSON.parse(fs.readFileSync(newFile));
    }
    res.send(itemTable);
}
/**
 * orderAction - act on an order for a buyer
 * @param {express.req} req - the inbound request object from the client
 * req.body.action - string with buyer requested action
 * buyer available actions are: 
 * Pay  - approve payment for an order
 * Dispute - dispute an existing order. requires a reason
 * Purchase - submit created order to seller for execution
 * Cancel - cancel an existing order
 * req.body.buyer - string with buyer id
 * req.body.orderNo - string with orderNo to be acted upon
 * req.body.reason - reason for dispute, required for dispute processing to proceed
 * @param {express.res} res - the outbound response object for communicating back to client
 * @param {express.next} next - an express service to enable post processing prior to responding to the client
 * returns an array of assets
 * @function
 */
exports.orderAction = function (req, res, next) {
    if ((req.body.action == 'Dispute') && (typeof(req.body.reason) != 'undefined') && (req.body.reason.length > 0) )
    {let reason = req.body.reason;} 
    else {
    if ((req.body.action == 'Dispute') && ((typeof(req.body.reason) == 'undefined') || (req.body.reason.length <1) ))
        res.send({'result': 'failed', 'error': 'no reason provided for dispute'});
    }
    console.log('req.body.orderNo is: ', req.body.orderNo);
    let businessNetworkConnection;
    let newFile = path.join(path.dirname(require.main.filename),'startup','memberList.txt');
    let _table = JSON.parse(fs.readFileSync(newFile));
    let _userID = ''; let _secret = '';
    let bFound = false;
    let updateOrder;
    for (let each in _table.members)
    { if (_table.members[each].id == req.body.buyer) {_secret = _table.members[each].secret; _userID=_table.members[each].userID; bFound = true;}}
    if (!bFound) {res.send({'result':req.body.id + 'not found'});}
        businessNetworkConnection = new BusinessNetworkConnection();
        return businessNetworkConnection.connect(config.composer.connectionProfile, config.composer.network, _userID, _secret)
        .then(() => {
            return businessNetworkConnection.getAssetRegistry(NS+'.Order')
            .then((assetRegistry) => {
                return assetRegistry.get(req.body.orderNo)
                .then((order) => {
                    let factory = businessNetworkConnection.getBusinessNetwork().getFactory();                    
                    order.status = req.body.action;
                    switch (req.body.action)
                    {
                        case 'Pay':
                        console.log('Pay entered');
                        updateOrder = factory.newTransaction(NS, 'Pay');                        
                        updateOrder.financeCo = factory.newRelationship(NS, 'FinanceCo', 'easymoney@easymoneyinc.com');
                        break;
                        case 'Dispute':
                        console.log('Dispute entered');
                        updateOrder = factory.newTransaction(NS, 'Dispute');                        
                        updateOrder.financeCo = factory.newRelationship(NS, 'FinanceCo', 'easymoney@easymoneyinc.com');
                        updateOrder.buyer = factory.newRelationship(NS, 'Buyer', order.buyer.$identifier);                        
                        break;
                        case 'Purchase':
                        console.log('Purchase entered');
                        updateOrder = factory.newTransaction(NS, 'Buy');                        
                        updateOrder.buyer = factory.newRelationship(NS, 'Buyer', order.buyer.$identifier);                        
                        break;
                        case 'Cancel':
                        console.log('Cancel entered');
                        updateOrder = factory.newTransaction(NS, 'OrderCancel');                        
                        updateOrder.buyer = factory.newRelationship(NS, 'Buyer', order.buyer.$identifier);                        
                        break;
                        default :
                        console.log('default entered');
                        res.send({'results': 'failed', 'error':' order '+req.body.orderNo+' unrecognized request: '+req.body.action});
                    }
                    updateOrder.order = factory.newRelationship(NS, 'Order', order.$identifier);
                    updateOrder.seller = factory.newRelationship(NS, 'Seller', order.seller.$identifier);
                    return businessNetworkConnection.submitTransaction(updateOrder)
                    .then(() => {
                        console.log(' order '+req.body.orderNo+" successfully updated to "+req.body.action);
                        res.send({'results': ' order '+req.body.orderNo+" successfully updated to "+req.body.action});
                    })
                    .catch((error) => {
                        console.log(req.body.orderNo+" submitTransaction to update status to "+req.body.action+" failed with text: ",error.message);
                        if (error.message.search('MVCC_READ_CONFLICT') != -1)
                            {console.log(" retrying assetRegistry.update for: "+req.body.orderNo);
                            svc.loadTransaction(updateOrder, req.body.orderNo, businessNetworkConnection);
                        }
                        });

                })
                .catch((error) => {
                    console.log('Registry Get Order failed: '+error.message);
                    res.send({'result': 'failed', 'error': 'Registry Get Order failed: '+error.message});
                });
            })
            .catch((error) => {console.log('Get Asset Registry failed: '+error.message);
            res.send({'result': 'failed', 'error': 'Get Asset Registry failed: '+error.message});
        });
        })
        .catch((error) => {console.log('Business Network Connect failed: '+error.message);
        res.send({'result': 'failed', 'error': 'Get Asset Registry failed: '+error.message});
    });
}
/**
 * adds an order to the blockchain
 * @param {express.req} req - the inbound request object from the client
 * req.body.seller - string with seller id
 * req.body.buyer - string with buyer id
 * req.body.items - array with items for order
 * @param {express.res} res - the outbound response object for communicating back to client
 * @param {express.next} next - an express service to enable post processing prior to responding to the client
 * returns an array of assets
 * @function
 */
exports.addOrder = function (req, res, next) {
    let businessNetworkConnection;
    let factory;
    let newFile = path.join(path.dirname(require.main.filename),'startup','memberList.txt');
    let _table = JSON.parse(fs.readFileSync(newFile));
    let _userID = ''; let _secret = '';
    let bFound = false;
    let ts = Date.now();
    let orderNo = req.body.buyer.replace(/@/, '').replace(/\./, '')+ts; 
    console.log(orderNo);
    
    for (let each in _table.members)
        { if (_table.members[each].id == req.body.buyer) {_secret = _table.members[each].secret; _userID=_table.members[each].userID; bFound = true;}}
    if (!bFound) {res.send({'result':req.body.id + 'not found'});}
            businessNetworkConnection = new BusinessNetworkConnection();
            return businessNetworkConnection.connect(config.composer.connectionProfile, config.composer.network, _userID, _secret)
            .then(() => {
                factory = businessNetworkConnection.getBusinessNetwork().getFactory();
                let order = factory.newResource(NS, 'Order', orderNo);
                order = svc.createOrderTemplate(order);
                order.amount = 0;
                order.orderNumber = orderNo;
                order.buyer = factory.newRelationship(NS, 'Buyer', req.body.buyer);
                order.seller = factory.newRelationship(NS, 'Seller', req.body.seller);
                for (let each in req.body.items)
                {(function(_idx, _arr)
                    {   _arr[_idx].description = _arr[_idx].itemDescription;
                        order.items.push(JSON.stringify(_arr[_idx]));
                        order.amount += parseInt(_arr[_idx].extendedPrice);
                    })(each, req.body.items)
                }
                // create the buy transaction
                const createNew = factory.newTransaction(NS, 'CreateOrder');
                
                createNew.order = factory.newRelationship(NS, 'Order', order.$identifier);
                createNew.buyer = factory.newRelationship(NS, 'Buyer', req.body.buyer);
                createNew.seller = factory.newRelationship(NS, 'Seller', req.body.seller);
                createNew.amount = order.amount;
                // add the order to the asset registry.
                return businessNetworkConnection.getAssetRegistry(NS+'.Order')
                .then((assetRegistry) => {
                    return assetRegistry.add(order)
                        .then(() => { 
                            return businessNetworkConnection.submitTransaction(createNew)
                            .then(() => {console.log(' order '+orderNo+" successfully added");
                            res.send({'results': ' order '+orderNo+' successfully added'});
                            })
                            .catch((error) => {
                                console.log(orderNo+" submitTransaction failed with text: ",error.message);
                                if (error.message.search('MVCC_READ_CONFLICT') != -1)
                                    {console.log(orderNo+" retrying assetRegistry.add for: "+orderNo);
                                    svc.loadTransaction(createNew, orderNo, businessNetworkConnection);
                                    }
                                });
                            })
                            .catch((error) => {
                            console.log(orderNo+" assetRegistry.add failed: ",error.message);
                            if (error.message.search('MVCC_READ_CONFLICT') != -1)
                                {console.log(orderNo+" retrying assetRegistry.add for: "+orderNo);
                                svc.loadTransaction(createNew, orderNo, businessNetworkConnection);
                            }
                            });                                        
                        })
                        .catch((error) => {
                        console.log(orderNo+" getAssetRegistry failed: ",error.message);
                        res.send({'results': 'failed', 'error':' order '+orderNo+' getAssetRegistry failed '+error.message});
                    });                                        
                })
            .catch((error) => {
                console.log(orderNo+" business network connection failed: text",error.message);
                res.send({'results': 'failed', 'error':' order '+orderNo+' add failed on on business network connection '+error.message});
                });                                        
        }