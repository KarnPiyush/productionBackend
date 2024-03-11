import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uplaodOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import { options } from "../utils/options.js";

const generateAccessAndRefreshTokens = async(userId) =>{
    try {
        const user = await User.findById(userId);
        const accessToken = await user.generateAccessToken();
        const refreshToken = await user.generateRefreshToken();
        
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave : false });

        return {accessToken , refreshToken};

    } catch (error) {
        throw new ApiError(500 , "Something went wrong while generating refresh and access token.")
    }
}

const registerUser = asyncHandler(async(req, res)=>{
    // get user details from frontend
    // validation - not empty
    // check if user already exists : username , email
    // check for images ,  check for avatar
    // upload them to cloudinary , avatar
    // create user object - create entry in db
    // remove password and refresh token field from response
    // check for user creation
    // return res

    const {fullName , email , username , password} = req.body;
    if(
        [fullName , email , username , password].some((field)=>{
            field ?.trim() === ""
        })
    ){
        throw new ApiError(400 , "All fields are required" )
    }

    const existedUser = await User.findOne({
        $or : [{ username }, { email }]
    })
    if(existedUser){
        throw new ApiError(409 , "user with email or username already exists")
    }

    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path;
    }


    if(!avatarLocalPath){
        throw new ApiError(400 , "Avatar file is required .");
    }

    const avatar = await uplaodOnCloudinary(avatarLocalPath);
    const coverImage = await uplaodOnCloudinary(coverImageLocalPath);
    
    if(!avatar){
        throw new ApiError(400 , "Avatar file is required .");
    }

    const user = await User.create({
        fullName, 
        avatar : avatar.url,
        coverImage : coverImage?.url || "",
        email,
        password,
        username : username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500 , "Something went wrong while registering the user")
    }

    return res.status(201).json(
        new ApiResponse(200 , createdUser , "User registered successfully")
    );

});

const loginUser = asyncHandler(async(req , res)=>{
    // req body->data
    // username or email
    // find the user
    // check password
    // access and refresh token
    // send cookie

    const {email , username ,password} = req.body;
    console.log(email);
    if(!(username || email)){
        throw new ApiError(400 , "username or email is required");
    }

    const user = await User.findOne({
        $or : [{username} , {email}]
    });

    if(!user){
        throw new ApiError(404 , "user does not exist.")
    }

    const isPasswordValid = await user.isPasswordCorrect(password);

    if(!isPasswordValid){
        throw new ApiError(400 , "Invalid user credentials");
    }

    const {accessToken , refreshToken} = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");


    // using this cookies can only be modified on server
    
    return res
    .status(200)
    .cookie("accessToken", accessToken , options)
    .cookie("refreshToken" , refreshToken , options)
    .json(
        new ApiResponse(
            200,
            {
                user : loggedInUser , 
                accessToken , refreshToken
            }, 
            "user logged in successfully"
        )
    )

});

const logoutUser = asyncHandler(async(req, res)=>{
    await User.findByIdAndUpdate(
        req.user._id ,  // getting req.user from auth.middleware.js
        {
            $set : {
                refreshToken : undefined
            }
        },
        {
            new : true
        }
    )

    return res
    .status(200)
    .clearCookie("accessToken" , options)
    .clearCookie("refreshToken" , options)
    .json(new ApiResponse(200 , {} ,  "User logged out."))
});

const refreshAccessToken = asyncHandler(async(req,res)=>{
    try {
        const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
        if(!incomingRefreshToken){
            throw new ApiError(401 , "unauthorized request");
        }
    
        const decodedToken = jwt.verify(incomingRefreshToken , process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decodedToken?._id);
    
        if(!user){
            throw new ApiError(401 , "Invalid refresh token.")
        }
    
        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401 , "Refresh token is expired or used")
        }
    
        const {accessToken , newRefreshToken} = await generateAccessAndRefreshTokens(user._id);
    
        return res
        .status(200)
        .cookie("accessToken" , accessToken , options)
        .cookie("refreshToken" , newRefreshToken , options)
        .json(
            new ApiResponse(
                200,
                {
                    accessToken , refreshToken : newRefreshToken
                },
                "access token refreshed"
            )
        )
    } catch (error) {
        throw new ApiError(401 , error?.message || "Invalid refresh token")
    }
    
});

export { 
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken
}